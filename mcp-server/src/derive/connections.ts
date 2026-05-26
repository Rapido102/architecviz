// Pure derivation logic: given a list of components, produce the connections
// that can be deterministically inferred from the data.
//
// Two derivation passes:
//   1. Frontend → Backend  : match component[frontend].routes[].api_calls
//                            against component[backend].endpoints[] by (method, normalized path)
//      Matching order:
//        a. Exact byte match
//        b. Semantic match (different param syntax — {id} vs :id)
//        c. Suffix match  (frontend calls /api/v1/users, backend exposes /users)
//           → handles API gateway/BFF prefix patterns
//   2. Backend → External  : reverse-lookup component[external].used_by[]

interface Endpoint {
  path: string;
  method: string;
  authenticated?: boolean;
}

interface Route {
  path: string;
  api_calls?: string[];
}

interface Component {
  id: string;
  type: string;
  layer?: string;
  routes?: Route[];
  endpoints?: Endpoint[];
  used_by?: string[];
}

interface EndpointMapping {
  frontend_endpoint: string;
  backend_endpoint: string;
  method: string;
  frontend_pages: string[];
  status: string;
}

interface Connection {
  id: string;
  from: string;
  to: string;
  protocol: string;
  authenticated: boolean;
  endpoint_mappings?: EndpointMapping[];
}

export interface UnmatchedApiCall {
  call: string;
  from_component: string;
  from_route: string;
  near_miss?: {
    backend: string;
    endpoint: string;
    similarity: number;
    hint: string;
  };
}

export interface DeriveSummary {
  frontends: number;
  backends: number;
  externals: number;
  connections_derived: number;
  endpoint_mappings_total: number;
  matched_api_calls: number;
  suffix_matched_api_calls: number;
  unmatched_api_calls: UnmatchedApiCall[];
}

export interface DeriveResult {
  connections: Connection[];
  summary: DeriveSummary;
}

const EXTERNAL_TYPES = new Set(['iam', 'third-party', 'monitoring', 'service']);

function parseApiCall(call: string): { method: string; path: string } | null {
  const m = call.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)$/i);
  if (!m) return null;
  return { method: m[1].toUpperCase(), path: m[2] };
}

function normalizePath(p: string): string {
  return p
    .replace(/\{[^}]+\}/g, ':param:')
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, ':param:')
    .replace(/\/$/, '')
    .toLowerCase();
}

type MatchKind = 'exact' | 'semantic' | 'suffix';

interface MatchResult {
  endpoint: Endpoint;
  kind: MatchKind;
}

// Exact + semantic match (existing logic).
function findDirectMatch(endpoints: Endpoint[], method: string, path: string): MatchResult | null {
  const norm = normalizePath(path);
  const exact = endpoints.find((e) => e.method.toUpperCase() === method && e.path === path);
  if (exact) return { endpoint: exact, kind: 'exact' };
  const semantic = endpoints.find(
    (e) => e.method.toUpperCase() === method && normalizePath(e.path) === norm,
  );
  if (semantic) return { endpoint: semantic, kind: 'semantic' };
  return null;
}

// Suffix match: strip leading path segments from the call one by one until
// a backend endpoint matches. Models gateway/BFF prefix patterns where the
// frontend calls /api/v1/users but the backend service exposes /users.
function findSuffixMatch(endpoints: Endpoint[], method: string, callPath: string): MatchResult | null {
  const segments = normalizePath(callPath).split('/').filter(Boolean);
  // Start from segment index 1 (drop the first segment) up to n-2 (keep at least one segment).
  // drop up to all-but-last segment — suffix must keep at least one segment
  for (let drop = 1; drop < segments.length; drop++) {
    const suffix = '/' + segments.slice(drop).join('/');
    const match = endpoints.find(
      (e) => e.method.toUpperCase() === method && normalizePath(e.path) === suffix,
    );
    if (match) return { endpoint: match, kind: 'suffix' };
  }
  return null;
}

// Path similarity score: fraction of normalised segments shared between two paths.
// Used to find the "nearest miss" endpoint for unmatched calls.
function pathSimilarity(a: string, b: string): number {
  const aSeg = normalizePath(a).split('/').filter(Boolean);
  const bSeg = normalizePath(b).split('/').filter(Boolean);
  if (aSeg.length === 0 && bSeg.length === 0) return 1;
  const commonCount = aSeg.filter((s) => bSeg.includes(s)).length;
  return commonCount / Math.max(aSeg.length, bSeg.length, 1);
}

interface NearMissResult {
  backendId: string;
  endpoint: Endpoint;
  similarity: number;
}

// Find the most similar backend endpoint for an unmatched call, cross all backends.
function findNearMiss(
  backends: Component[],
  method: string,
  path: string,
): NearMissResult | null {
  let best: NearMissResult | null = null;
  for (const be of backends) {
    // Only compare same-method endpoints.
    const candidates = (be.endpoints ?? []).filter((e) => e.method.toUpperCase() === method);
    for (const ep of candidates) {
      const sim = pathSimilarity(path, ep.path);
      if (sim >= 0.4 && (!best || sim > best.similarity)) {
        best = { backendId: be.id, endpoint: ep, similarity: sim };
      }
    }
  }
  return best;
}

function dedupeMappings(mappings: EndpointMapping[]): EndpointMapping[] {
  const byKey = new Map<string, EndpointMapping>();
  for (const m of mappings) {
    const key = `${m.method}|${m.frontend_endpoint}`;
    const existing = byKey.get(key);
    if (existing) {
      const pages = new Set([...existing.frontend_pages, ...m.frontend_pages]);
      existing.frontend_pages = Array.from(pages);
    } else {
      byKey.set(key, { ...m, frontend_pages: [...m.frontend_pages] });
    }
  }
  return Array.from(byKey.values());
}

function protocolForExternal(type: string): string {
  if (type === 'iam') return 'OIDC/HTTPS';
  if (type === 'monitoring') return 'HTTPS';
  return 'REST/HTTPS';
}

function mappingStatus(kind: MatchKind): string {
  if (kind === 'exact') return '✅ MAPPÉ';
  if (kind === 'semantic') return '⚠️ À VÉRIFIER (syntaxe param différente)';
  return '⚠️ SUFFIX MATCH — préfixe probable (gateway/BFF)';
}

export function deriveConnections(components: Component[]): DeriveResult {
  const frontends = components.filter((c) => c.type === 'frontend');
  const backends = components.filter((c) => c.type === 'backend');
  const externals = components.filter(
    (c) => EXTERNAL_TYPES.has(c.type) || c.layer === 'External',
  );

  const connections: Connection[] = [];
  const unmatched: UnmatchedApiCall[] = [];
  let matchedCount = 0;
  let suffixMatchedCount = 0;

  // 1. Frontend → Backend
  for (const fe of frontends) {
    const byBackend = new Map<string, EndpointMapping[]>();

    for (const route of fe.routes ?? []) {
      for (const call of route.api_calls ?? []) {
        const parsed = parseApiCall(call);
        if (!parsed) {
          unmatched.push({ call, from_component: fe.id, from_route: route.path });
          continue;
        }

        // Try direct match across all backends.
        let found: { backendId: string; match: MatchResult } | null = null;
        for (const be of backends) {
          const m = findDirectMatch(be.endpoints ?? [], parsed.method, parsed.path);
          if (m) { found = { backendId: be.id, match: m }; break; }
        }

        // Fall back to suffix match if direct failed.
        if (!found) {
          for (const be of backends) {
            const m = findSuffixMatch(be.endpoints ?? [], parsed.method, parsed.path);
            if (m) {
              found = { backendId: be.id, match: m };
              suffixMatchedCount++;
              break;
            }
          }
        }

        if (!found) {
          // Record near-miss to help Claude fix the mismatch.
          const nm = findNearMiss(backends, parsed.method, parsed.path);
          unmatched.push({
            call,
            from_component: fe.id,
            from_route: route.path,
            near_miss: nm
              ? {
                  backend: nm.backendId,
                  endpoint: `${nm.endpoint.method} ${nm.endpoint.path}`,
                  similarity: Math.round(nm.similarity * 100) / 100,
                  hint: nm.similarity >= 0.7
                    ? 'chemin très similaire — vérifier le préfixe gateway'
                    : 'chemin partiellement similaire — vérifier method + path',
                }
              : undefined,
          });
          continue;
        }

        matchedCount++;
        const mapping: EndpointMapping = {
          frontend_endpoint: `${parsed.method} ${parsed.path}`,
          backend_endpoint: found.match.endpoint.path,
          method: parsed.method,
          frontend_pages: [route.path],
          status: mappingStatus(found.match.kind),
        };

        const arr = byBackend.get(found.backendId) ?? [];
        arr.push(mapping);
        byBackend.set(found.backendId, arr);
      }
    }

    for (const [backendId, mappings] of byBackend) {
      const be = backends.find((b) => b.id === backendId);
      if (!be) continue;
      const deduped = dedupeMappings(mappings);
      const anyAuth = deduped.some((m) => {
        const ep = be.endpoints?.find(
          (e) => e.path === m.backend_endpoint && e.method.toUpperCase() === m.method,
        );
        return ep?.authenticated === true;
      });

      connections.push({
        id: `${fe.id}_to_${backendId}`,
        from: fe.id,
        to: backendId,
        protocol: 'REST/HTTPS',
        authenticated: anyAuth,
        endpoint_mappings: deduped,
      });
    }
  }

  // 2. Backend → External (via reverse-lookup of used_by)
  for (const ext of externals) {
    for (const consumerId of ext.used_by ?? []) {
      const consumer = components.find((c) => c.id === consumerId);
      if (!consumer || consumer.type !== 'backend') continue;
      const dupId = `${consumerId}_to_${ext.id}`;
      if (connections.some((c) => c.id === dupId)) continue;
      connections.push({
        id: dupId,
        from: consumerId,
        to: ext.id,
        protocol: protocolForExternal(ext.type),
        authenticated: ext.type !== 'iam',
      });
    }
  }

  return {
    connections,
    summary: {
      frontends: frontends.length,
      backends: backends.length,
      externals: externals.length,
      connections_derived: connections.length,
      endpoint_mappings_total: connections.reduce(
        (sum, c) => sum + (c.endpoint_mappings?.length ?? 0),
        0,
      ),
      matched_api_calls: matchedCount,
      suffix_matched_api_calls: suffixMatchedCount,
      unmatched_api_calls: unmatched,
    },
  };
}
