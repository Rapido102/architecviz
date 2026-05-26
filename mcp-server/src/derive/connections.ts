// Pure derivation logic: given a list of components, produce the connections
// that can be deterministically inferred from the data.
//
// Two derivation passes:
//   1. Frontend → Backend  : match component[frontend].routes[].api_calls
//                            against component[backend].endpoints[] by (method, normalized path)
//   2. Backend → External  : reverse-lookup component[external].used_by[]
//                            (any external component that lists a backend id as consumer)

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

export interface DeriveSummary {
  frontends: number;
  backends: number;
  externals: number;
  connections_derived: number;
  endpoint_mappings_total: number;
  matched_api_calls: number;
  unmatched_api_calls: { call: string; from_component: string; from_route: string }[];
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
    // Spring-style: {id}, {userId}
    .replace(/\{[^}]+\}/g, ':param:')
    // Express/Rails-style: :id, :userId
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, ':param:')
    // Trailing slash
    .replace(/\/$/, '')
    .toLowerCase();
}

function findMatchingEndpoint(
  endpoints: Endpoint[],
  method: string,
  path: string,
): { endpoint: Endpoint; exact: boolean } | null {
  const normalizedCall = normalizePath(path);
  // Exact byte match (same syntax)
  let match = endpoints.find((e) => e.method.toUpperCase() === method && e.path === path);
  if (match) return { endpoint: match, exact: true };
  // Same semantic path (different syntax — e.g., {id} vs :id)
  match = endpoints.find(
    (e) => e.method.toUpperCase() === method && normalizePath(e.path) === normalizedCall,
  );
  if (match) return { endpoint: match, exact: false };
  return null;
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

export function deriveConnections(components: Component[]): DeriveResult {
  const frontends = components.filter((c) => c.type === 'frontend');
  const backends = components.filter((c) => c.type === 'backend');
  const externals = components.filter(
    (c) => EXTERNAL_TYPES.has(c.type) || c.layer === 'External',
  );

  const connections: Connection[] = [];
  const unmatched: DeriveSummary['unmatched_api_calls'] = [];
  let matchedCount = 0;

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

        let found: { backendId: string; match: { endpoint: Endpoint; exact: boolean } } | null = null;
        for (const be of backends) {
          const m = findMatchingEndpoint(be.endpoints ?? [], parsed.method, parsed.path);
          if (m) {
            found = { backendId: be.id, match: m };
            break;
          }
        }

        if (!found) {
          unmatched.push({ call, from_component: fe.id, from_route: route.path });
          continue;
        }

        matchedCount++;
        const mapping: EndpointMapping = {
          frontend_endpoint: `${parsed.method} ${parsed.path}`,
          backend_endpoint: found.match.endpoint.path,
          method: parsed.method,
          frontend_pages: [route.path],
          status: found.match.exact ? '✅ MAPPÉ' : '⚠️ À VÉRIFIER',
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
      unmatched_api_calls: unmatched,
    },
  };
}
