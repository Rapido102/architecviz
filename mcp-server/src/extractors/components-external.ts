import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const MISSING = 'À confirmer';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
function readJson<T = unknown>(path: string): T | null {
  const raw = readIfExists(path);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
function slugify(s: string): string {
  return s.replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
/** Canonical cross-stack slug (kebab-case) used as a default `external_ref` suggestion. */
function canonicalSlug(s: string): string {
  return s.replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'out', 'vendor', '__pycache__', '.venv']);
function findFiles(dir: string, test: (name: string) => boolean, maxDepth = 8): string[] {
  const out: string[] = [];
  const walk = (cur: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(cur); } catch { return; }
    for (const e of entries) {
      const full = join(cur, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(e)) walk(full, depth + 1); }
      else if (test(e)) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

export function extractExternalComponents(projectPath: string, backendId = 'backend_api'): {
  fragment: Record<string, unknown>[];
  detected: boolean;
  notes: string[];
} {
  const pkg = readJson<PackageJson>(resolve(projectPath, 'package.json'));
  const deps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};
  const depsStr = JSON.stringify(deps);
  const buildFile =
    (readIfExists(resolve(projectPath, 'pom.xml')) ?? '') +
    (readIfExists(resolve(projectPath, 'build.gradle')) ?? '') +
    (readIfExists(resolve(projectPath, 'build.gradle.kts')) ?? '');
  const py = (readIfExists(resolve(projectPath, 'pyproject.toml')) ?? '') + (readIfExists(resolve(projectPath, 'requirements.txt')) ?? '');

  // application config (Spring)
  const ymlFiles = findFiles(resolve(projectPath, 'src', 'main', 'resources'), (n) => /^application.*\.(ya?ml|properties)$/.test(n), 4);
  const yml = ymlFiles.map((f) => readIfExists(f) ?? '').join('\n');

  const components: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (c: Record<string, unknown>) => {
    if (seen.has(c.id as string)) return;
    seen.add(c.id as string);
    components.push(c);
  };

  // ── IAM ─────────────────────────────────────────────────────────────────
  const issuerUri = yml.match(/issuer-uri\s*[:=]\s*["']?([^"'\s]+)/i)?.[1];
  if (/keycloak/i.test(buildFile) || deps['keycloak-js'] || deps['keycloak-connect'] || /python-keycloak/i.test(py)) {
    push({ id: 'iam_keycloak', label: 'Keycloak IAM', type: 'iam', layer: 'External', technology: 'Keycloak', url: issuerUri ?? '${KEYCLOAK_URL}', used_by: [backendId] });
  } else if (depsStr.includes('@auth0') || /auth0/i.test(py)) {
    push({ id: 'iam_auth0', label: 'Auth0', type: 'iam', layer: 'External', technology: 'Auth0', url: '${AUTH0_DOMAIN}', used_by: [backendId] });
  } else if (deps['openid-client'] || deps['oidc-client-ts'] || /spring-boot-starter-oauth2|oauth2-resource-server/i.test(buildFile) || issuerUri) {
    push({ id: 'iam_oidc', label: 'OIDC Provider', type: 'iam', layer: 'External', technology: 'OIDC', url: issuerUri ?? '${OIDC_ISSUER_URI}', used_by: [backendId] });
  }

  // ── Feign clients (Spring) → third-party ──────────────────────────────────
  const javaFiles = findFiles(resolve(projectPath, 'src', 'main', 'java'), (n) => n.endsWith('.java'));
  let feignCount = 0;
  for (const f of javaFiles) {
    const src = readIfExists(f) ?? '';
    if (!src.includes('@FeignClient')) continue;
    const name = src.match(/@FeignClient\s*\([^)]*name\s*=\s*["']([^"']+)["']/)?.[1];
    const url = src.match(/@FeignClient\s*\([^)]*url\s*=\s*["']([^"']+)["']/)?.[1];
    const base = name ?? basename(f, '.java').replace(/Client$|Feign$/g, '');
    const id = slugify(base) + (slugify(base).endsWith('_api') ? '' : '_api');
    // Methods (paths) — lightweight regex
    const endpoints = [...src.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)].map((m) => ({ path: m[2], method: m[1].toUpperCase() }));
    push({ id, label: base.charAt(0).toUpperCase() + base.slice(1) + ' API', type: 'third-party', layer: 'External', technology: 'REST API (OpenFeign)', url: url ?? '${' + slugify(base).toUpperCase() + '_URL}', consumed_via: 'OpenFeign', external_ref: canonicalSlug(base), ...(endpoints.length ? { endpoints } : {}), used_by: [backendId] });
    feignCount++;
  }
  if (feignCount > 0) notes.push(`${feignCount} client(s) Feign détecté(s) → composant(s) third-party (external_ref canonique suggéré ; ne relie une architecture que si une stack du même slug existe, sinon sans effet).`);

  // ── Monitoring ────────────────────────────────────────────────────────────
  if (/datadog|dd-trace/i.test(buildFile) || deps['dd-trace'] || /ddtrace/i.test(py)) {
    push({ id: 'monitoring_datadog', label: 'Datadog', type: 'monitoring', layer: 'External', technology: 'Datadog Agent', url: '${DATADOG_URL}', used_by: [backendId] });
  }
  if (/micrometer-registry-prometheus/i.test(buildFile) || deps['prom-client'] || /prometheus_client/i.test(py)) {
    push({ id: 'monitoring_prometheus', label: 'Prometheus', type: 'monitoring', layer: 'External', technology: 'Prometheus', url: '${PROMETHEUS_URL}', used_by: [backendId] });
  }
  if (depsStr.includes('@sentry') || /sentry-sdk|io\.sentry/i.test(buildFile + py)) {
    push({ id: 'monitoring_sentry', label: 'Sentry', type: 'monitoring', layer: 'External', technology: 'Sentry', url: '${SENTRY_DSN}', used_by: [backendId] });
  }
  if (/opentelemetry|otel/i.test(buildFile) || depsStr.includes('@opentelemetry') || /opentelemetry/i.test(py)) {
    push({ id: 'monitoring_otel', label: 'OpenTelemetry', type: 'monitoring', layer: 'External', technology: 'OpenTelemetry', url: '${OTEL_EXPORTER_OTLP_ENDPOINT}', used_by: [backendId] });
  }

  if (components.length === 0) {
    notes.push('Aucun composant externe détecté (iam/third-party/monitoring).');
  } else {
    notes.push(`${components.length} composant(s) externe(s) : ${components.map((c) => c.id).join(', ')}`);
    notes.push(`used_by prérempli avec "${backendId}" — ajuster si l'ID du backend diffère (rename_component).`);
  }

  return { fragment: components, detected: components.length > 0, notes };
}
