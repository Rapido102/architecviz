import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractEndpointsAndDataAccess, type ExtractionCoverage, type DataAccessCandidate } from './endpoints.js';

const MISSING = 'À confirmer';

interface PackageJson {
  name?: string;
  displayName?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readJson<T = unknown>(path: string): T | null {
  const raw = readIfExists(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function stripVersion(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, '').trim();
}

function slugify(s: string): string {
  return s
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function humanize(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface BackendDetection {
  stack: 'spring' | 'nestjs' | 'express' | 'fastapi' | 'go' | 'dotnet' | null;
  technology: string;
  id_hint: string;
  port?: number;
}

function detectSpring(projectPath: string): BackendDetection | null {
  const pom = readIfExists(resolve(projectPath, 'pom.xml'));
  if (pom) {
    const artifactId = pom.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? 'backend';
    const javaVersion = pom.match(/<java\.version>([^<]+)<\/java\.version>/)?.[1];
    const springBoot =
      pom.match(/spring-boot-starter-parent[^<]*?<version>([^<]+)<\/version>/s)?.[1] ??
      pom.match(/<spring-boot\.version>([^<]+)<\/spring-boot\.version>/)?.[1];
    const parts: string[] = [];
    if (javaVersion) parts.push(`Java ${javaVersion}`);
    if (springBoot) parts.push(`Spring Boot ${springBoot}`);
    if (parts.length === 0) parts.push('Spring (version à confirmer)');
    return { stack: 'spring', technology: parts.join(' + '), id_hint: slugify(artifactId) };
  }
  const gradle =
    readIfExists(resolve(projectPath, 'build.gradle')) ??
    readIfExists(resolve(projectPath, 'build.gradle.kts'));
  if (gradle && /springBoot|spring-boot/.test(gradle)) {
    const v = gradle.match(/springBoot\s*\{[^}]*version\s*=?\s*['"]([^'"]+)['"]/s)?.[1];
    return {
      stack: 'spring',
      technology: v ? `Spring Boot ${v}` : 'Spring Boot (version à confirmer)',
      id_hint: 'backend_spring',
    };
  }
  return null;
}

function detectNode(projectPath: string): BackendDetection | null {
  const pkg = readJson<PackageJson>(resolve(projectPath, 'package.json'));
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const id = slugify(pkg.name ?? 'backend');

  if (deps['@nestjs/core']) {
    return {
      stack: 'nestjs',
      technology: `NestJS ${stripVersion(deps['@nestjs/core'])}`,
      id_hint: id,
    };
  }
  if (deps['express']) {
    return {
      stack: 'express',
      technology: `Express ${stripVersion(deps['express'])}`,
      id_hint: id,
    };
  }
  if (deps['fastify']) {
    return {
      stack: 'express',
      technology: `Fastify ${stripVersion(deps['fastify'])}`,
      id_hint: id,
    };
  }
  if (deps['hono']) {
    return { stack: 'express', technology: `Hono ${stripVersion(deps['hono'])}`, id_hint: id };
  }
  return null;
}

function detectPython(projectPath: string): BackendDetection | null {
  const py = readIfExists(resolve(projectPath, 'pyproject.toml'));
  const req = readIfExists(resolve(projectPath, 'requirements.txt'));
  const raw = `${py ?? ''}\n${req ?? ''}`;
  if (!raw.trim()) return null;
  if (/(^|\s)fastapi\b/.test(raw)) {
    return { stack: 'fastapi', technology: 'FastAPI (Python)', id_hint: 'backend_fastapi' };
  }
  if (/(^|\s)django\b/.test(raw)) {
    return { stack: 'fastapi', technology: 'Django (Python)', id_hint: 'backend_django' };
  }
  if (/(^|\s)flask\b/.test(raw)) {
    return { stack: 'fastapi', technology: 'Flask (Python)', id_hint: 'backend_flask' };
  }
  return null;
}

function detectGo(projectPath: string): BackendDetection | null {
  const mod = readIfExists(resolve(projectPath, 'go.mod'));
  if (!mod) return null;
  const goVersion = mod.match(/^go\s+([\d.]+)/m)?.[1] ?? '';
  let router = '';
  if (/github\.com\/gin-gonic\/gin/.test(mod)) router = ' + Gin';
  else if (/github\.com\/labstack\/echo/.test(mod)) router = ' + Echo';
  else if (/github\.com\/go-chi\/chi/.test(mod)) router = ' + chi';
  else if (/github\.com\/gorilla\/mux/.test(mod)) router = ' + gorilla/mux';
  return {
    stack: 'go',
    technology: `Go${goVersion ? ' ' + goVersion : ''}${router}`,
    id_hint: 'backend_go',
  };
}

function detectPort(projectPath: string): number | undefined {
  const appYml = readIfExists(resolve(projectPath, 'src/main/resources/application.yml'));
  if (appYml) {
    const m = appYml.match(/^\s*port\s*:\s*(\d+)/m);
    if (m) return Number(m[1]);
  }
  const appProps = readIfExists(resolve(projectPath, 'src/main/resources/application.properties'));
  if (appProps) {
    const m = appProps.match(/^\s*server\.port\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function detectDeployment(projectPath: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (existsSync(resolve(projectPath, 'Dockerfile'))) {
    out.containerized = true;
    out.platform = 'Docker';
  }
  if (existsSync(resolve(projectPath, '.gitlab-ci.yml'))) out.ci_cd = 'GitLab CI';
  else if (existsSync(resolve(projectPath, '.github', 'workflows'))) out.ci_cd = 'GitHub Actions';
  else if (existsSync(resolve(projectPath, 'Jenkinsfile'))) out.ci_cd = 'Jenkins';
  if (
    existsSync(resolve(projectPath, 'helm')) ||
    existsSync(resolve(projectPath, 'k8s')) ||
    existsSync(resolve(projectPath, 'manifests'))
  ) {
    out.orchestration = 'Kubernetes';
  }
  if (Object.keys(out).length === 0) return { platform: MISSING };
  return out;
}

export function extractBackendComponents(projectPath: string): {
  fragment: Record<string, unknown>[];
  detected: boolean;
  notes: string[];
  coverage?: ExtractionCoverage;
  data_access_candidates?: DataAccessCandidate[];
} {
  const detection =
    detectSpring(projectPath) ??
    detectNode(projectPath) ??
    detectPython(projectPath) ??
    detectGo(projectPath);

  if (!detection) {
    return {
      fragment: [],
      detected: false,
      notes: [
        'Aucun framework backend reconnu (Spring/NestJS/Express/Fastify/FastAPI/Django/Flask/Go)',
        'Vérifier que projectPath pointe bien vers la racine du projet backend',
      ],
    };
  }

  const port = detectPort(projectPath);
  const { endpoints, dataAccessCandidates, coverage } = extractEndpointsAndDataAccess(projectPath, detection.stack);

  const component: Record<string, unknown> = {
    id: detection.id_hint,
    label: humanize(detection.id_hint),
    type: 'backend',
    layer: 'Backend',
    technology: detection.technology,
    url: MISSING,
    ...(port !== undefined ? { port } : {}),
    provenance: 'auto',
    authentication: {
      type: MISSING,
      provider: MISSING,
      token_format: MISSING,
      token_expiry: MISSING,
      roles_permissions: MISSING,
      note: '',
    },
    endpoints,
    // Stored as hints for the enrichment plan — Claude confirms/assigns them as real data_access entries.
    ...(dataAccessCandidates.length > 0 ? { data_access_candidates: dataAccessCandidates } : {}),
    deployment: detectDeployment(projectPath),
  };

  const notes = [
    `Stack détectée : ${detection.stack}`,
    `${endpoints.length} endpoint(s) extrait(s) automatiquement (provenance=auto) — vérifier paths/auth puis compléter description, params, data_access.`,
    `${dataAccessCandidates.length} candidat(s) data_access détecté(s) — à rattacher aux endpoints via la passe LLM.`,
  ];
  if (coverage.blind_spots.length) notes.push(`Angles morts : ${coverage.blind_spots.join(' ')}`);

  return { fragment: [component], detected: true, notes, coverage, data_access_candidates: dataAccessCandidates };
}
