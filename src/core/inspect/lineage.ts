// v2 — Data lineage : impact analysis + queries. Pur.

import type { ArchitectureConfig } from '../../types';
import type { LineageReport } from './report-types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HOT_TABLE_THRESHOLD = 3;
const CHATTY_ENDPOINT_THRESHOLD = 5;

interface EndpointRef {
  component_id: string;
  method: string;
  path: string;
  authenticated?: boolean;
}
interface EndpointWithComponent extends EndpointRef {
  data_access_count: number;
}

function iterateBackendEndpoints(arch: ArchitectureConfig): EndpointWithComponent[] {
  const out: EndpointWithComponent[] = [];
  for (const c of arch.components ?? []) {
    if (c.type !== 'backend') continue;
    for (const e of c.endpoints ?? []) {
      out.push({ component_id: c.id, method: e.method.toUpperCase(), path: e.path, authenticated: e.authenticated, data_access_count: (e.data_access ?? []).length });
    }
  }
  return out;
}

export function computeLineage(arch: ArchitectureConfig): LineageReport {
  const tableTouches = new Map<string, EndpointRef[]>();
  const dbComponents = (arch.components ?? []).filter((c) => c.type === 'db');

  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      for (const da of e.data_access ?? []) {
        if (!dbComponents.some((db) => db.id === da.component_id)) continue;
        const key = `${da.component_id}::${da.resource}`;
        const arr = tableTouches.get(key) ?? [];
        arr.push({ component_id: c.id, method: e.method.toUpperCase(), path: e.path, authenticated: e.authenticated });
        tableTouches.set(key, arr);
      }
    }
  }

  const deadTables: LineageReport['dead_tables'] = [];
  for (const db of dbComponents) {
    for (const t of db.tables ?? []) {
      if (!tableTouches.has(`${db.id}::${t.name}`)) deadTables.push({ component_id: db.id, name: t.name });
    }
  }

  const hotTables: LineageReport['hot_tables'] = [];
  for (const [key, eps] of tableTouches) {
    if (eps.length < HOT_TABLE_THRESHOLD) continue;
    const [componentId, name] = key.split('::', 2);
    hotTables.push({ component_id: componentId, name, touched_by: eps.length, via_endpoints: eps.slice(0, 10).map((e) => `${e.method} ${e.path}`) });
  }
  hotTables.sort((a, b) => b.touched_by - a.touched_by);

  const chatty: LineageReport['chatty_endpoints'] = iterateBackendEndpoints(arch)
    .filter((e) => e.data_access_count >= CHATTY_ENDPOINT_THRESHOLD)
    .map((e) => ({ method: e.method, path: e.path, component: e.component_id, data_access_count: e.data_access_count }))
    .sort((a, b) => b.data_access_count - a.data_access_count);

  const unauthMutating: LineageReport['unauthenticated_endpoints_mutating'] = iterateBackendEndpoints(arch)
    .filter((e) => MUTATING_METHODS.has(e.method) && e.authenticated === false)
    .map((e) => ({ method: e.method, path: e.path, component: e.component_id }));

  return { dead_tables: deadTables, hot_tables: hotTables, chatty_endpoints: chatty, unauthenticated_endpoints_mutating: unauthMutating };
}

// ── Lineage graph helper (UI) : composants + connexions touchés par un endpoint ──

export interface LineageHighlight {
  /** ids des composants à surligner */
  componentIds: Set<string>;
  /** ids des connexions à surligner */
  connectionIds: Set<string>;
}

/** Pour un endpoint donné (par sa data_access), renvoie le sous-graphe à surligner. */
export function highlightForEndpoint(arch: ArchitectureConfig, componentId: string, method: string, path: string): LineageHighlight {
  const componentIds = new Set<string>([componentId]);
  const connectionIds = new Set<string>();

  const comp = (arch.components ?? []).find((c) => c.id === componentId);
  const ep = comp?.endpoints?.find((e) => e.method.toUpperCase() === method.toUpperCase() && e.path === path);
  if (!ep) return { componentIds, connectionIds };

  // 1) data_access targets
  for (const da of ep.data_access ?? []) {
    componentIds.add(da.component_id);
  }

  // 2) frontends qui appellent cet endpoint (via endpoint_mappings) + la connexion
  for (const conn of arch.connections ?? []) {
    if (conn.to !== componentId) continue;
    const calls = (conn.endpoint_mappings ?? []).some(
      (m) => m.method.toUpperCase() === method.toUpperCase() && m.backend_endpoint === path,
    );
    if (calls) {
      componentIds.add(conn.from);
      if (conn.id) connectionIds.add(conn.id);
    }
  }

  // 3) connexions reliant le composant à ses data_access targets
  for (const conn of arch.connections ?? []) {
    if (conn.from === componentId && componentIds.has(conn.to) && conn.id) connectionIds.add(conn.id);
  }

  return { componentIds, connectionIds };
}

/** Pour une table (db component + nom), renvoie les composants qui la touchent + les connexions. */
export function highlightForTable(arch: ArchitectureConfig, dbComponentId: string, tableName: string): LineageHighlight {
  const componentIds = new Set<string>([dbComponentId]);
  const connectionIds = new Set<string>();

  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      for (const da of e.data_access ?? []) {
        const resource = da.resource.split('.').pop()?.replace(/[`"']/g, '') ?? da.resource;
        if (da.component_id === dbComponentId && resource === tableName) {
          componentIds.add(c.id);
        }
      }
    }
  }

  for (const conn of arch.connections ?? []) {
    if (componentIds.has(conn.from) && componentIds.has(conn.to) && conn.id) connectionIds.add(conn.id);
  }

  return { componentIds, connectionIds };
}

// ── Query mode (réutilisé par le MCP et l'UI) ──

export function runQuery(arch: ArchitectureConfig, query: string): unknown {
  const [name, ...argParts] = query.split(':');
  const arg = argParts.join(':');
  switch (name.trim()) {
    case 'what_touches_table': return queryWhatTouchesTable(arch, arg);
    case 'endpoints_calling': return queryEndpointsCalling(arch, arg);
    case 'touches_for_endpoint': {
      const [method, ...pathParts] = arg.split(':');
      return queryTouchesForEndpoint(arch, method.toUpperCase(), pathParts.join(':'));
    }
    case 'dead_tables': return computeLineage(arch).dead_tables;
    case 'hot_tables': return computeLineage(arch).hot_tables;
    case 'chatty_endpoints': return computeLineage(arch).chatty_endpoints;
    case 'unauthenticated_mutations': return computeLineage(arch).unauthenticated_endpoints_mutating;
    case 'components_isolated': return queryIsolatedComponents(arch);
    case 'help': return { available_queries: ['what_touches_table:<name>', 'endpoints_calling:<component_id>', 'touches_for_endpoint:<METHOD>:<path>', 'dead_tables', 'hot_tables', 'chatty_endpoints', 'unauthenticated_mutations', 'components_isolated'] };
    default: return { error: `Unknown query "${name}". Use query="help".` };
  }
}

function queryWhatTouchesTable(arch: ArchitectureConfig, tableName: string) {
  const out: { component_id: string; method: string; path: string; operation: string; via_db: string }[] = [];
  const dbIds = new Set((arch.components ?? []).filter((c) => c.type === 'db').map((c) => c.id));
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      for (const da of e.data_access ?? []) {
        if (!dbIds.has(da.component_id)) continue;
        const resource = da.resource.split('.').pop()?.replace(/[`"']/g, '') ?? da.resource;
        if (resource === tableName) out.push({ component_id: c.id, method: e.method.toUpperCase(), path: e.path, operation: da.operation, via_db: da.component_id });
      }
    }
  }
  return { table: tableName, count: out.length, endpoints: out };
}

function queryEndpointsCalling(arch: ArchitectureConfig, componentId: string) {
  const out: { component_id: string; method: string; path: string; resource: string; operation: string }[] = [];
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      for (const da of e.data_access ?? []) {
        if (da.component_id !== componentId) continue;
        out.push({ component_id: c.id, method: e.method.toUpperCase(), path: e.path, resource: da.resource, operation: da.operation });
      }
    }
  }
  return { component_id: componentId, count: out.length, endpoints: out };
}

function queryTouchesForEndpoint(arch: ArchitectureConfig, method: string, path: string) {
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      if (e.method.toUpperCase() === method && e.path === path) {
        return { component_id: c.id, method, path, authenticated: e.authenticated, data_access: e.data_access ?? [] };
      }
    }
  }
  return { error: `Endpoint ${method} ${path} not found.` };
}

function queryIsolatedComponents(arch: ArchitectureConfig) {
  const out: { id: string; type: string; layer: string }[] = [];
  for (const c of arch.components ?? []) {
    if (c.layer === 'External') continue;
    const hasIn = (arch.connections ?? []).some((conn) => conn.to === c.id);
    const hasOut = (arch.connections ?? []).some((conn) => conn.from === c.id);
    if (!hasIn && !hasOut) out.push({ id: c.id, type: c.type, layer: c.layer });
  }
  return out;
}
