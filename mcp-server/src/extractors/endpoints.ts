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
  description?: string;
  status_codes?: string[];
  params?: Record<string, string[]>;
  response_schema?: string;
  provenance: 'auto';
}

export interface DataAccessCandidate {
  resource: string;
  operation: string;
  kind: 'db' | 'cache' | 'mq';
  evidence: string;
  provenance: 'auto';
}

interface OperationMeta {
  description?: string;
  status_codes?: string[];
  authenticated?: boolean;
  response_schema?: string;
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

// Find the first '{' or ';' in text that is NOT inside a string literal or line comment.
// Used to locate the method body start (or interface method end) without false-positives
// from path templates like @Path("/{id}") or commented-out annotations.
function methodBodyStart(text: string, maxLen = 800): number {
  let inStr = false;
  let strChar = '';
  let inLineComment = false;
  const end = Math.min(text.length, maxLen);
  for (let i = 0; i < end; i++) {
    const c = text[i];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
    } else if (inStr) {
      if (c === strChar) inStr = false;
      else if (c === '\\') i++;
    } else if (c === '/' && i + 1 < end && text[i + 1] === '/') {
      inLineComment = true;
    } else if (c === '"' || c === "'") {
      inStr = true; strChar = c;
    } else if (c === '{' || c === ';') {
      return i;
    }
  }
  return end;
}

// Extract a balanced-parentheses block starting at openIdx (the '(' character).
function extractBlock(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      if (--depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx, Math.min(openIdx + 2000, src.length));
}

// Find the Java method name in the window of text following an annotation block.
// Skips annotation lines, looks for the first 'lowerCaseWord(' that isn't a Java keyword.
function methodNameFromWindow(win: string): string | null {
  const JAVA_KW = new Set([
    'void', 'int', 'long', 'boolean', 'return', 'if', 'for', 'while', 'catch', 'try',
    'new', 'super', 'this', 'null', 'throw', 'throws', 'extends', 'implements',
    'instanceof', 'default', 'switch', 'case', 'else', 'do', 'break', 'continue',
    'import', 'package', 'class', 'interface', 'enum', 'abstract', 'final', 'static',
    'synchronized', 'volatile', 'private', 'public', 'protected', 'native', 'transient',
  ]);
  for (const line of win.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('@') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const m = t.match(/\b([a-z][A-Za-z0-9_]*)\s*\(/);
    if (m && !JAVA_KW.has(m[1])) return m[1];
  }
  return null;
}

// Pre-scan all Java files to build a map of method name → OperationMeta from Swagger
// @Operation / @ApiResponse / @SecurityRequirement annotations (typically on interfaces).
function buildSpringOperationMeta(files: string[], unreadable: string[]): Map<string, OperationMeta> {
  const meta = new Map<string, OperationMeta>();

  for (const f of files) {
    const src = read(f, unreadable);
    if (!src || !src.includes('@Operation(')) continue;

    let searchFrom = 0;
    while (true) {
      const opIdx = src.indexOf('@Operation(', searchFrom);
      if (opIdx === -1) break;

      const parenIdx = opIdx + '@Operation'.length; // index of '('
      const block = extractBlock(src, parenIdx);
      searchFrom = parenIdx + block.length;

      const description = block.match(/description\s*=\s*"([^"]*)"/)?.[1];

      const status_codes: string[] = [];
      const seenCodes = new Set<string>();
      for (const rc of block.matchAll(/responseCode\s*=\s*"(\d+)"/g)) {
        if (!seenCodes.has(rc[1])) { status_codes.push(rc[1]); seenCodes.add(rc[1]); }
      }

      const authenticated = /@SecurityRequirement\b/.test(block) ? true : undefined;
      const response_schema = block.match(/implementation\s*=\s*([A-Za-z0-9_]+)\.class/)?.[1];

      const afterBlock = src.slice(parenIdx + block.length, parenIdx + block.length + 600);
      const methodName = methodNameFromWindow(afterBlock);

      if (methodName) {
        const existing = meta.get(methodName) ?? {};
        meta.set(methodName, {
          description: description ?? existing.description,
          status_codes: status_codes.length ? status_codes : existing.status_codes,
          authenticated: authenticated ?? existing.authenticated,
          response_schema: response_schema ?? existing.response_schema,
        });
      }
    }
  }

  return meta;
}

// ── Spring ───────────────────────────────────────────────────────────────────
function extractSpring(projectPath: string, cov: ExtractionCoverage): { endpoints: ExtractedEndpoint[]; da: DataAccessCandidate[] } {
  const root = resolve(projectPath, 'src', 'main', 'java');
  const files = walk(root, (n) => n.endsWith('.java'), cov.files_unreadable);
  const javaRoot = resolve(projectPath, 'src', 'main', 'resources');
  const xmlFiles = walk(javaRoot, (n) => n.toLowerCase().endsWith('mapper.xml'), cov.files_unreadable);
  cov.files_scanned += files.length + xmlFiles.length;

  // Pre-build Swagger/OpenAPI operation metadata from all Java files (usually interfaces)
  const opMetaMap = buildSpringOperationMeta(files, cov.files_unreadable);

  const endpoints: ExtractedEndpoint[] = [];
  const da: DataAccessCandidate[] = [];

  const MAPPING_RE = /@(Get|Post|Put|Patch|Delete)Mapping(?:\s*\(([^)]*)\))?/g;
  const REQ_MAPPING_RE = /@RequestMapping\s*\(([^)]*)\)/g;
  const JAXRS_HTTP_RE = /@(GET|POST|PUT|DELETE|PATCH|HEAD)\b/g;

  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;
    const isController = /@(RestController|Controller)\b/.test(src);
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
        const stop = methodBodyStart(after);
        const win = after.slice(0, stop);
        const sub = win.match(/@Path\s*\(\s*["']([^"']*)["']/)?.[1] ?? '';
        const authWin = src.slice(Math.max(0, jm.index - 200), jm.index + stop);
        const localAuth = classAuth || /@RolesAllowed\b|@PreAuthorize\b|@Secured\b/.test(authWin) ? true : undefined;

        // Look up Swagger metadata by method name (cross-reference with interface annotations)
        const jaxMethodName = win.match(/\b([a-z][A-Za-z0-9_]*)\s*\(/)?.[1];
        const opMeta = jaxMethodName ? opMetaMap.get(jaxMethodName) : undefined;

        // Extract path/query params from JAX-RS annotations
        const params: Record<string, string[]> = {};
        for (const pm of win.matchAll(/@PathParam\s*\(\s*["']([^"']+)["']/g)) {
          (params['path'] = params['path'] ?? []).push(pm[1]);
        }
        for (const pm of win.matchAll(/@QueryParam\s*\(\s*["']([^"']+)["']/g)) {
          (params['query'] = params['query'] ?? []).push(pm[1]);
        }
        for (const pm of win.matchAll(/@FormParam\s*\(\s*["']([^"']+)["']/g)) {
          (params['form'] = params['form'] ?? []).push(pm[1]);
        }

        endpoints.push({
          path: joinPath(base, sub),
          method,
          authenticated: opMeta?.authenticated ?? localAuth,
          description: opMeta?.description,
          status_codes: opMeta?.status_codes?.length ? opMeta.status_codes : undefined,
          params: Object.keys(params).length ? params : undefined,
          response_schema: opMeta?.response_schema,
          provenance: 'auto',
        });
      }
    }

    if (isController) {
      cov.controllers_found++;
      const head = src.split(/\bclass\s/)[0] ?? '';
      const baseMatches = [...head.matchAll(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/g)];
      const base = baseMatches.length ? baseMatches[baseMatches.length - 1][1] : '';
      const classAuth = /@(PreAuthorize|Secured|RolesAllowed)\b/.test(head);

      let m: RegExpExecArray | null;
      MAPPING_RE.lastIndex = 0;
      while ((m = MAPPING_RE.exec(src)) !== null) {
        const httpMethod = m[1].toUpperCase();
        const args = m[2] ?? '';
        const pathLit = args.match(/["']([^"']*)["']/)?.[1] ?? '';
        const ctx = src.slice(Math.max(0, m.index - 200), m.index);
        const localAuth = classAuth || /@(PreAuthorize|Secured|RolesAllowed)\b/.test(ctx) ? true : undefined;

        // Window after the mapping annotation: method signature + parameter list
        const after = src.slice(m.index + m[0].length);
        const brace = after.indexOf('{');
        const semi = after.indexOf(';');
        const stop = Math.min(brace < 0 ? Infinity : brace, semi < 0 ? Infinity : semi, 500);
        const win = after.slice(0, stop);

        const springMethodName = win.match(/\b([a-z][A-Za-z0-9_]*)\s*\(/)?.[1];
        const opMeta = springMethodName ? opMetaMap.get(springMethodName) : undefined;

        const params: Record<string, string[]> = {};
        for (const pm of win.matchAll(/@PathVariable\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)) {
          (params['path'] = params['path'] ?? []).push(pm[1]);
        }
        for (const pm of win.matchAll(/@RequestParam\s*\(\s*(?:(?:name|value)\s*=\s*)?["']([^"']+)["']/g)) {
          (params['query'] = params['query'] ?? []).push(pm[1]);
        }
        if (/@RequestBody\b/.test(win)) {
          (params['body'] = params['body'] ?? []).push('body');
        }

        endpoints.push({
          path: joinPath(base, pathLit),
          method: httpMethod,
          authenticated: opMeta?.authenticated ?? localAuth,
          description: opMeta?.description,
          status_codes: opMeta?.status_codes?.length ? opMeta.status_codes : undefined,
          params: Object.keys(params).length ? params : undefined,
          response_schema: opMeta?.response_schema,
          provenance: 'auto',
        });
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

    const rel = relative(projectPath, f);

    // ── data_access candidates ──
    // @Query (+ @Modifying)
    for (const q of src.matchAll(/@Query\s*\(\s*(?:value\s*=\s*)?["'`]([\s\S]*?)["'`]/g)) {
      const parsed = opFromSql(q[1]);
      if (parsed && parsed.table !== '?') {
        da.push({ resource: parsed.table, operation: parsed.operation, kind: 'db', evidence: `${rel} @Query`, provenance: 'auto' });
      }
    }
    // @Entity / @Table(name="X")
    for (const t of src.matchAll(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/g)) {
      da.push({ resource: t[1], operation: 'SELECT', kind: 'db', evidence: `${rel} @Table`, provenance: 'auto' });
    }
    // @Cacheable / @CachePut / @CacheEvict
    for (const c of src.matchAll(/@(Cacheable|CachePut|CacheEvict)\s*\(([^)]*)\)/g)) {
      const name = c[2].match(/(?:value|cacheNames)\s*=\s*["']([^"']+)["']/)?.[1] ?? c[2].match(/["']([^"']+)["']/)?.[1];
      if (name) {
        const op = c[1] === 'CacheEvict' ? 'EVICT' : c[1] === 'Cacheable' ? 'GET' : 'SET';
        da.push({ resource: name, operation: op, kind: 'cache', evidence: `${rel} @${c[1]}`, provenance: 'auto' });
      }
    }
    // Kafka producers / consumers
    for (const k of src.matchAll(/kafkaTemplate\.send\s*\(\s*["']([^"']+)["']/g)) {
      da.push({ resource: k[1], operation: 'PUBLISH', kind: 'mq', evidence: `${rel} kafkaTemplate.send`, provenance: 'auto' });
    }
    for (const k of src.matchAll(/@KafkaListener\s*\([^)]*topics?\s*=\s*(?:\{\s*)?["']([^"']+)["']/g)) {
      da.push({ resource: k[1], operation: 'SUBSCRIBE', kind: 'mq', evidence: `${rel} @KafkaListener`, provenance: 'auto' });
    }
    // Spring Data repository.save/delete (entity unknown → generic table marker)
    if (/extends\s+(Jpa|Crud|PagingAndSorting)Repository</.test(src)) {
      const ent = src.match(/Repository<\s*([A-Za-z0-9_]+)\s*,/)?.[1];
      if (ent) {
        da.push({ resource: ent, operation: 'UPSERT', kind: 'db', evidence: `${rel} Spring Data repo`, provenance: 'auto' });
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
function extractNest(projectPath: string, cov: ExtractionCoverage): { endpoints: ExtractedEndpoint[]; da: DataAccessCandidate[] } {
  const files = walk(resolve(projectPath, 'src'), (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'), cov.files_unreadable);
  cov.files_scanned += files.length;
  const endpoints: ExtractedEndpoint[] = [];
  const da: DataAccessCandidate[] = [];

  for (const f of files) {
    const src = read(f, cov.files_unreadable);
    if (!src) continue;

    const isController = /@Controller\b/.test(src);

    if (isController) {
      cov.controllers_found++;
      const base = src.match(/@Controller\s*\(\s*["']([^"']*)["']/)?.[1] ?? '';
      const classHead = src.split(/\bclass\s/)[0] ?? '';
      const classAuth = /@UseGuards\b/.test(classHead);

      for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(\s*(["'][^"']*["'])?\s*\)/g)) {
        const method = m[1].toUpperCase();
        const pathLit = m[2]?.replace(/["']/g, '') ?? '';

        // Context before the endpoint decorator: look for @ApiOperation, @ApiResponse, @UseGuards
        const ctx = src.slice(Math.max(0, m.index! - 600), m.index!);

        // Description from @ApiOperation({ summary: '...', description: '...' })
        const apiOpMatch = ctx.match(/@ApiOperation\s*\(\s*\{[^}]*(?:summary|description)\s*:\s*['"]([^'"]*)['"]/);
        const description = apiOpMatch?.[1];

        // Status codes from @ApiResponse({ status: NNN }) — collect all in the ctx window
        const status_codes: string[] = [];
        const seenCodes = new Set<string>();
        for (const ar of ctx.matchAll(/@ApiResponse\s*\(\s*\{[^}]*status\s*:\s*(\d+)/g)) {
          if (!seenCodes.has(ar[1])) { status_codes.push(ar[1]); seenCodes.add(ar[1]); }
        }

        // Auth: class-level guard OR method-level guard in ctx
        const localAuth = classAuth || /@UseGuards\b/.test(ctx) ? true : undefined;

        // Window after the decorator: method signature with parameter decorators
        const after = src.slice(m.index! + m[0].length);
        const braceIdx = after.indexOf('{');
        const win = after.slice(0, braceIdx < 0 ? 500 : Math.min(braceIdx, 500));

        // Params from @Param / @Query / @Body
        const params: Record<string, string[]> = {};
        for (const pm of win.matchAll(/@Param\s*\(\s*["']([^"']+)["']/g)) {
          (params['path'] = params['path'] ?? []).push(pm[1]);
        }
        for (const pm of win.matchAll(/@Query\s*\(\s*["']([^"']+)["']/g)) {
          (params['query'] = params['query'] ?? []).push(pm[1]);
        }
        if (/@Body\s*\(/.test(win)) {
          (params['body'] = params['body'] ?? []).push('body');
        }

        endpoints.push({
          path: joinPath(base, pathLit),
          method,
          authenticated: localAuth,
          description: description || undefined,
          status_codes: status_codes.length ? status_codes : undefined,
          params: Object.keys(params).length ? params : undefined,
          provenance: 'auto',
        });
      }
    }

    const rel = relative(projectPath, f);

    // ── data_access candidates ──

    // TypeORM: @InjectRepository(Entity) → entity name
    for (const m of src.matchAll(/@InjectRepository\s*\(\s*([A-Za-z0-9_]+)\s*\)/g)) {
      da.push({ resource: m[1], operation: 'REPOSITORY', kind: 'db', evidence: `${rel} @InjectRepository(${m[1]})`, provenance: 'auto' });
    }

    // TypeORM repository method calls: this.xyzRepo.find/save/update/delete
    for (const m of src.matchAll(/this\.\w*[Rr]ep(?:ository|o)?\w*\.(find(?:One(?:By)?|By|AndCount)?|save|update|delete|remove|count|upsert)\s*\(/g)) {
      da.push({ resource: '?', operation: m[1].toUpperCase(), kind: 'db', evidence: `${rel} repo.${m[1]}`, provenance: 'auto' });
    }

    // Prisma: this.prisma.model.operation(...)
    for (const m of src.matchAll(/this\.prisma\.(\w+)\.(findMany|findFirst|findUnique|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*\(/g)) {
      const op = m[2].toUpperCase();
      da.push({ resource: m[1], operation: op, kind: 'db', evidence: `${rel} prisma.${m[1]}.${m[2]}`, provenance: 'auto' });
    }

    // Redis: this.*redis*.get/set/del/hget/hset/lpush/rpush
    for (const m of src.matchAll(/this\.\w*[Rr]edis\w*\.(get|set|del|hget|hset|hgetall|lpush|rpush|lrange|zadd|zrange|expire|exists)\s*\(\s*[`'"]([\w:{}$*-]+)[`'"]/g)) {
      da.push({ resource: m[2], operation: m[1].toUpperCase(), kind: 'cache', evidence: `${rel} redis.${m[1]}`, provenance: 'auto' });
    }

    // Kafka @EventPattern (consumer)
    for (const m of src.matchAll(/@EventPattern\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      da.push({ resource: m[1], operation: 'SUBSCRIBE', kind: 'mq', evidence: `${rel} @EventPattern`, provenance: 'auto' });
    }
    // Kafka @MessagePattern (request-reply consumer)
    for (const m of src.matchAll(/@MessagePattern\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      da.push({ resource: m[1], operation: 'SUBSCRIBE', kind: 'mq', evidence: `${rel} @MessagePattern`, provenance: 'auto' });
    }
    // Kafka client producer: client.emit / client.send
    for (const m of src.matchAll(/(?:this\.\w+Client|kafkaClient)\.(emit|send)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      da.push({ resource: m[2], operation: 'PUBLISH', kind: 'mq', evidence: `${rel} kafkaClient.${m[1]}`, provenance: 'auto' });
    }

    // Bull / BullMQ: @InjectQueue('name') → queue name
    for (const m of src.matchAll(/@InjectQueue\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
      da.push({ resource: m[1], operation: 'ENQUEUE', kind: 'mq', evidence: `${rel} @InjectQueue`, provenance: 'auto' });
    }
    // Bull: @Process / @Processor (consumer)
    for (const m of src.matchAll(/@Process(?:or)?\s*\(\s*['"`]?([^'"`)\s]+)['"`]?\s*\)/g)) {
      da.push({ resource: m[1], operation: 'CONSUME', kind: 'mq', evidence: `${rel} @Process`, provenance: 'auto' });
    }
  }

  return { endpoints, da };
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
    if (!prev) {
      seen.set(key, e);
    } else {
      // Prefer the entry with more metadata
      const merged: ExtractedEndpoint = { ...prev };
      if (prev.authenticated === undefined && e.authenticated !== undefined) merged.authenticated = e.authenticated;
      if (!prev.description && e.description) merged.description = e.description;
      if (!prev.status_codes?.length && e.status_codes?.length) merged.status_codes = e.status_codes;
      if (!prev.params && e.params) merged.params = e.params;
      if (!prev.response_schema && e.response_schema) merged.response_schema = e.response_schema;
      seen.set(key, merged);
    }
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
    case 'nestjs': {
      const r = extractNest(projectPath, coverage);
      endpoints = r.endpoints;
      dataAccessCandidates = r.da;
      coverage.blind_spots.push("Auth NestJS : guards de classe détectés, guards conditionnels ou guards globaux non évalués.");
      break;
    }
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
