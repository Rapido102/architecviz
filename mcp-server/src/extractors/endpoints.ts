// Deterministic endpoint + data_access extraction per framework.
// Best-effort regex/source scan (no full AST) — feasibility already proven by the
// Feign scan in components-external.ts. Produces endpoints with provenance="auto"
// and *candidate* data_access signals for the LLM pass to attach + confirm.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

export type BackendStack = 'spring' | 'nestjs' | 'express' | 'fastapi' | 'go' | 'dotnet' | null;

export interface ExtractedEndpoint {
  path: string;
  method: string;
  authenticated?: boolean;
  provenance: 'auto';
}

export interface DataAccessCandidate {
  resource: string;
  operation: string;
  kind: 'db' | 'cache' | 'mq';
  evidence: string;
  provenance: 'auto';
}

export interface ExtractionCoverage {
  stack: string;
  files_scanned: number;
  controllers_found: number;
  endpoints_extracted: number;
  endpoints_by_method: Record<string, number>;
  files_unreadable: string[];
  data_access_candidates: number;
  blind_spots: string[];
}

export interface EndpointExtraction {
  endpoints: ExtractedEndpoint[];
  dataAccessCandidates: DataAccessCandidate[];
  coverage: ExtractionCoverage;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.next', 'out', 'vendor', '__pycache__', '.venv',
]);

function walk(dir: string, test: (name: string) => boolean, unreadable: string[], maxDepth = 10): string[] {
  const out: string[] = [];
  const rec = (cur: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      unreadable.push(cur);
      return;
    }
    for (const e of entries) {
      const full = join(cur, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        unreadable.push(full);
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e)) rec(full, depth + 1);
      } else if (test(e)) {
        out.push(full);
      }
    }
  };
  rec(dir, 0);
  return out;
}

function read(path: string, unreadable: string[]): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    unreadable.push(path);
    return null;
  }
}

function joinPath(base: string, sub: string): string {
  const b = (base || '').replace(/\/+$/, '');
  let s = sub || '';
  if (s && !s.startsWith('/')) s = '/' + s;
  const out = (b + s).replace(/\/{2,}/g, '/');
  return out === '' ? '/' : out;
}

function opFromSql(sql: string): { operation: string; table: string } | null {
  const s = sql.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = s.match(/\bINSERT\s+INTO\s+["`]?([\w.]+)/i))) return { operation: 'INSERT', table: m[1] };
  if ((m = s.match(/\bUPDATE\s+["`]?([\w.]+)/i))) return { operation: 'UPDATE', table: m[1] };
  if ((m = s.match(/\bDELETE\s+FROM\s+["`]?([\w.]+)/i))) return { operation: 'DELETE', table: m[1] };
  if ((m = s.match(/\bFROM\s+["`]?([\w.]+)/i))) return { operation: 'SELECT', table: m[1] };
  if (/\bSELECT\b/i.test(s)) return { operation: 'SELECT', table: '?' };
  return null;
}

// ── Spring ───────────────────────────────────────────────────────────────────
function extractSpring(projectPath: string, cov: ExtractionCoverage): { endpoints: ExtractedEndpoint[]; da: DataAccessCandidate[] } {
  const root = resolve(projectPath, 'src', 'main', 'java');
  const files = walk(root, (n) => n.endsWith('.java'), cov.files_unreadable);
  const javaRoot = resolve(projectPath, 'src', 'main', 'resources');
  const xmlFiles = walk(javaRoot, (n) => n.toLowerCase().endsWith('mapper.xml'), cov.files_unreadable);
  cov.files_scanned += files.length + xmlFiles.length;

  const endpoints: ExtractedEndpoint[] = [];
  const da: DataAccessCandidate[] = [];

  const MAPPING_RE = /@(Get|Post|Put|Patch|Delete)Mapping(?:\s*\(([^)]*)\))?/g;
  const REQ_MAPPING_RE = /@RequestMapping\s*\(([^)]*)\)/g;
  const JAXRS_HTTP_RE = /@(GET|POST|PUT|DELETE|PATCH|HEAD)\b/g;

  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;
    const isController = /@(RestController|Controller)\b/.test(src);
    // JAX-RS / Jersey (the Fortuneo/Arkéa stack): @Path + @GET/@POST… on a class or interface.
    const isJaxrs = /@Path\b/.test(src) && JAXRS_HTTP_RE.test(src);
    JAXRS_HTTP_RE.lastIndex = 0;

    if (isJaxrs) {
      cov.controllers_found++;
      const head = src.split(/\b(?:class|interface)\s/)[0] ?? '';
      const baseMatches = [...head.matchAll(/@Path\s*\(\s*["']([^"']*)["']/g)];
      const base = baseMatches.length ? baseMatches[baseMatches.length - 1][1] : '';
      const classAuth = /@(RolesAllowed|PreAuthorize|Secured)\b/.test(head);
      let jm: RegExpExecArray | null;
      JAXRS_HTTP_RE.lastIndex = 0;
      while ((jm = JAXRS_HTTP_RE.exec(src)) !== null) {
        const method = jm[1].toUpperCase();
        const after = src.slice(jm.index + jm[0].length);
        const brace = after.indexOf('{');
        const semi = after.indexOf(';');
        const stop = Math.min(brace < 0 ? Infinity : brace, semi < 0 ? Infinity : semi, 400);
        const win = after.slice(0, stop);
        const sub = win.match(/@Path\s*\(\s*["']([^"']*)["']/)?.[1] ?? '';
        const authWin = src.slice(Math.max(0, jm.index - 200), jm.index + stop);
        const authenticated = classAuth || /@RolesAllowed\b|@PreAuthorize\b|@Secured\b/.test(authWin) ? true : undefined;
        endpoints.push({ path: joinPath(base, sub), method, authenticated, provenance: 'auto' });
      }
    }

    if (isController) {
      cov.controllers_found++;
      // class-level base path: last @RequestMapping path before "class "
      const head = src.split(/\bclass\s/)[0] ?? '';
      const baseMatches = [...head.matchAll(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/g)];
      const base = baseMatches.length ? baseMatches[baseMatches.length - 1][1] : '';
      const classAuth = /@(PreAuthorize|Secured|RolesAllowed)\b/.test(head);

      let m: RegExpExecArray | null;
      MAPPING_RE.lastIndex = 0;
      while ((m = MAPPING_RE.exec(src)) !== null) {
        const method = m[1].toUpperCase();
        const args = m[2] ?? '';
        const pathLit = args.match(/["']([^"']*)["']/)?.[1] ?? '';
        // local auth: scan a small window before the annotation
        const ctx = src.slice(Math.max(0, m.index - 200), m.index);
        const authenticated = classAuth || /@(PreAuthorize|Secured|RolesAllowed)\b/.test(ctx) ? true : undefined;
        endpoints.push({ path: joinPath(base, pathLit), method, authenticated, provenance: 'auto' });
      }

      // @RequestMapping(method = RequestMethod.X, value="...") as endpoints
      REQ_MAPPING_RE.lastIndex = 0;
      while ((m = REQ_MAPPING_RE.exec(src)) !== null) {
        const args = m[1];
        const rm = args.match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/i);
        const pathLit = args.match(/["']([^"']+)["']/)?.[1];
        if (rm && pathLit) {
          endpoints.push({ path: joinPath(base, pathLit), method: rm[1].toUpperCase(), provenance: 'auto' });
        }
      }
    }

    // ── data_access candidates ──
    // @Query (+ @Modifying)
    for (const q of src.matchAll(/@Query\s*\(\s*(?:value\s*=\s*)?["'`]([\s\S]*?)["'`]/g)) {
      const parsed = opFromSql(q[1]);
      if (parsed && parsed.table !== '?') {
        da.push({ resource: parsed.table, operation: parsed.operation, kind: 'db', evidence: `${relative(projectPath, f)} @Query`, provenance: 'auto' });
      }
    }
    // @Entity / @Table(name="X")
    for (const t of src.matchAll(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/g)) {
      da.push({ resource: t[1], operation: 'SELECT', kind: 'db', evidence: `${relative(projectPath, f)} @Table`, provenance: 'auto' });
    }
    // @Cacheable / @CachePut / @CacheEvict
    for (const c of src.matchAll(/@(Cacheable|CachePut|CacheEvict)\s*\(([^)]*)\)/g)) {
      const name = c[2].match(/(?:value|cacheNames)\s*=\s*["']([^"']+)["']/)?.[1] ?? c[2].match(/["']([^"']+)["']/)?.[1];
      if (name) {
        const op = c[1] === 'CacheEvict' ? 'EVICT' : c[1] === 'Cacheable' ? 'GET' : 'SET';
        da.push({ resource: name, operation: op, kind: 'cache', evidence: `${relative(projectPath, f)} @${c[1]}`, provenance: 'auto' });
      }
    }
    // Kafka producers / consumers
    for (const k of src.matchAll(/kafkaTemplate\.send\s*\(\s*["']([^"']+)["']/g)) {
      da.push({ resource: k[1], operation: 'PUBLISH', kind: 'mq', evidence: `${relative(projectPath, f)} kafkaTemplate.send`, provenance: 'auto' });
    }
    for (const k of src.matchAll(/@KafkaListener\s*\([^)]*topics?\s*=\s*(?:\{\s*)?["']([^"']+)["']/g)) {
      da.push({ resource: k[1], operation: 'SUBSCRIBE', kind: 'mq', evidence: `${relative(projectPath, f)} @KafkaListener`, provenance: 'auto' });
    }
    // Spring Data repository.save/delete (entity unknown → generic table marker)
    if (/extends\s+(Jpa|Crud|PagingAndSorting)Repository</.test(src)) {
      const ent = src.match(/Repository<\s*([A-Za-z0-9_]+)\s*,/)?.[1];
      if (ent) {
        da.push({ resource: ent, operation: 'UPSERT', kind: 'db', evidence: `${relative(projectPath, f)} Spring Data repo`, provenance: 'auto' });
      }
    }
  }

  // MyBatis Mapper.xml
  for (const f of xmlFiles) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;
    for (const s of src.matchAll(/<(select|insert|update|delete)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const parsed = opFromSql(s[2]);
      if (parsed && parsed.table !== '?') {
        da.push({ resource: parsed.table, operation: parsed.operation, kind: 'db', evidence: `${relative(projectPath, f)} <${s[1].toLowerCase()}>`, provenance: 'auto' });
      }
    }
  }

  return { endpoints, da };
}

// ── NestJS ─────────────────────────────────────────────────────────────────
function extractNest(projectPath: string, cov: ExtractionCoverage): ExtractedEndpoint[] {
  const files = walk(resolve(projectPath, 'src'), (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'), cov.files_unreadable);
  cov.files_scanned += files.length;
  const endpoints: ExtractedEndpoint[] = [];
  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src || !/@Controller\b/.test(src)) continue;
    cov.controllers_found++;
    const base = src.match(/@Controller\s*\(\s*["']([^"']*)["']/)?.[1] ?? '';
    const classAuth = /@UseGuards\b/.test(src.split(/\bclass\s/)[0] ?? '');
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(\s*(["'][^"']*["'])?\s*\)/g)) {
      const method = m[1].toUpperCase();
      const pathLit = m[2]?.replace(/["']/g, '') ?? '';
      const ctx = src.slice(Math.max(0, m.index - 160), m.index);
      const authenticated = classAuth || /@UseGuards\b/.test(ctx) ? true : undefined;
      endpoints.push({ path: joinPath(base, pathLit), method, authenticated, provenance: 'auto' });
    }
  }
  return endpoints;
}

// ── Express / Fastify / Hono ─────────────────────────────────────────────────
function extractExpress(projectPath: string, cov: ExtractionCoverage): ExtractedEndpoint[] {
  const files = walk(resolve(projectPath, 'src'), (n) => /\.(t|j)s$/.test(n) && !/\.(spec|test)\./.test(n), cov.files_unreadable);
  cov.files_scanned += files.length;
  const endpoints: ExtractedEndpoint[] = [];
  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;
    for (const m of src.matchAll(/\b(?:app|router|api|server)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      endpoints.push({ path: joinPath('', m[2]), method: m[1].toUpperCase(), provenance: 'auto' });
    }
  }
  if (endpoints.length) cov.controllers_found = Math.max(cov.controllers_found, 1);
  cov.blind_spots.push("Express : préfixes de montage (app.use('/api', router)) non résolus — paths potentiellement partiels.");
  return endpoints;
}

// ── FastAPI ──────────────────────────────────────────────────────────────────
function extractFastapi(projectPath: string, cov: ExtractionCoverage): ExtractedEndpoint[] {
  const files = walk(projectPath, (n) => n.endsWith('.py') && !n.startsWith('test_'), cov.files_unreadable);
  cov.files_scanned += files.length;
  const endpoints: ExtractedEndpoint[] = [];
  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;
    const prefix = src.match(/APIRouter\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/)?.[1] ?? '';
    let any = false;
    for (const m of src.matchAll(/@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g)) {
      endpoints.push({ path: joinPath(prefix, m[2]), method: m[1].toUpperCase(), provenance: 'auto' });
      any = true;
    }
    if (any) cov.controllers_found++;
  }
  cov.blind_spots.push('FastAPI : authentification (Depends) non inférée — à confirmer.');
  return endpoints;
}

function dedupeEndpoints(eps: ExtractedEndpoint[]): ExtractedEndpoint[] {
  const seen = new Map<string, ExtractedEndpoint>();
  for (const e of eps) {
    const key = `${e.method} ${e.path}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, e);
    else if (prev.authenticated === undefined && e.authenticated !== undefined) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function dedupeCandidates(da: DataAccessCandidate[]): DataAccessCandidate[] {
  const seen = new Map<string, DataAccessCandidate>();
  for (const c of da) {
    const key = `${c.kind}|${c.resource}|${c.operation}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

export function extractEndpointsAndDataAccess(projectPath: string, stack: BackendStack): EndpointExtraction {
  const coverage: ExtractionCoverage = {
    stack: stack ?? 'unknown',
    files_scanned: 0,
    controllers_found: 0,
    endpoints_extracted: 0,
    endpoints_by_method: {},
    files_unreadable: [],
    data_access_candidates: 0,
    blind_spots: [],
  };

  let endpoints: ExtractedEndpoint[] = [];
  let dataAccessCandidates: DataAccessCandidate[] = [];

  switch (stack) {
    case 'spring': {
      const r = extractSpring(projectPath, coverage);
      endpoints = r.endpoints;
      dataAccessCandidates = r.da;
      coverage.blind_spots.push("Auth par endpoint inférée des annotations @PreAuthorize/@Secured — la config SecurityFilterChain n'est pas évaluée.");
      break;
    }
    case 'nestjs':
      endpoints = extractNest(projectPath, coverage);
      break;
    case 'express':
      endpoints = extractExpress(projectPath, coverage);
      break;
    case 'fastapi':
      endpoints = extractFastapi(projectPath, coverage);
      break;
    default:
      coverage.blind_spots.push(`Extraction d'endpoints non implémentée pour la stack "${stack}".`);
  }

  endpoints = dedupeEndpoints(endpoints);
  dataAccessCandidates = dedupeCandidates(dataAccessCandidates);

  coverage.endpoints_extracted = endpoints.length;
  for (const e of endpoints) coverage.endpoints_by_method[e.method] = (coverage.endpoints_by_method[e.method] ?? 0) + 1;
  coverage.data_access_candidates = dataAccessCandidates.length;
  if (endpoints.length === 0 && stack) {
    coverage.blind_spots.push('Aucun endpoint extrait — vérifier le chemin du projet ou compléter via la passe LLM.');
  }

  return { endpoints, dataAccessCandidates, coverage };
}
