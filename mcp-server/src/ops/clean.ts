// Safe cleanup operations. Designed to be idempotent — run twice, no further changes.

import { getDefaultLayers } from '../manifest-loader.js';
import { recomputeSummary } from './recompute.js';

interface Architecture {
  type?: string;
  layers?: Layer[];
  components?: Component[];
  connections?: Connection[];
  warnings?: Warning[];
  [key: string]: unknown;
}

interface Layer {
  name: string;
  color?: string;
  description?: string;
  [key: string]: unknown;
}

interface Component {
  id: string;
  layer: string;
  type?: string;
  used_by?: string[];
  endpoints?: Endpoint[];
  [key: string]: unknown;
}

interface Endpoint {
  method: string;
  path: string;
  data_access?: { component_id: string; resource: string; operation: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

interface Connection {
  id?: string;
  from?: string;
  to?: string;
  protocol?: string;
  endpoint_mappings?: { method: string; frontend_endpoint: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

interface Warning {
  severity: string;
  message: string;
  component: string;
  [key: string]: unknown;
}

export interface CleanResult {
  changes: {
    orphan_connections_removed: { id: string; reason: string }[];
    orphan_used_by_removed: { component: string; ref: string }[];
    orphan_data_access_removed: { component: string; ref: string }[];
    orphan_warnings_removed: { component: string; message: string }[];
    missing_layers_added: { name: string; color: string }[];
    duplicate_components_removed: string[];
    duplicate_endpoints_removed: { component: string; key: string }[];
    duplicate_connections_removed: string[];
    type_global_fixed: { from: string; to: string } | null;
    summary_recomputed: { changed_fields: string[] } | null;
  };
}

const PASTEL_PALETTE = ['#FBE9E7', '#E0F7FA', '#FCE4EC', '#E8EAF6', '#F1F8E9', '#FFF8E1'];

export function cleanArchitecture(arch: Architecture, options: { fixTypeGlobal?: boolean } = {}): CleanResult {
  const changes: CleanResult['changes'] = {
    orphan_connections_removed: [],
    orphan_used_by_removed: [],
    orphan_data_access_removed: [],
    orphan_warnings_removed: [],
    missing_layers_added: [],
    duplicate_components_removed: [],
    duplicate_endpoints_removed: [],
    duplicate_connections_removed: [],
    type_global_fixed: null,
    summary_recomputed: null,
  };

  const components = arch.components ?? [];

  // 1) Ensure layers[] is populated with defaults if empty
  if (!Array.isArray(arch.layers) || arch.layers.length === 0) {
    arch.layers = getDefaultLayers() as Layer[];
  }

  // 2) Add missing layers referenced by components but absent from layers[]
  const layerNames = new Set((arch.layers ?? []).map((l) => l.name));
  const referencedLayers = new Set<string>();
  for (const c of components) referencedLayers.add(c.layer);
  let paletteIdx = 0;
  for (const name of referencedLayers) {
    if (!name) continue;
    if (!layerNames.has(name)) {
      const color = PASTEL_PALETTE[paletteIdx++ % PASTEL_PALETTE.length];
      (arch.layers as Layer[]).push({
        name,
        color,
        description: `À confirmer`,
      });
      layerNames.add(name);
      changes.missing_layers_added.push({ name, color });
    }
  }

  // 3) Dedup components by id (keep first, drop subsequent)
  const seenComponents = new Map<string, Component>();
  const dedupedComponents: Component[] = [];
  for (const c of components) {
    if (seenComponents.has(c.id)) {
      changes.duplicate_components_removed.push(c.id);
      continue;
    }
    seenComponents.set(c.id, c);
    dedupedComponents.push(c);
  }
  arch.components = dedupedComponents;

  // 4) Dedup endpoints per component by (method, path)
  for (const c of arch.components ?? []) {
    if (!Array.isArray(c.endpoints)) continue;
    const seen = new Set<string>();
    const out: Endpoint[] = [];
    for (const e of c.endpoints) {
      const key = `${e.method.toUpperCase()} ${e.path}`;
      if (seen.has(key)) {
        changes.duplicate_endpoints_removed.push({ component: c.id, key });
        continue;
      }
      seen.add(key);
      out.push(e);
    }
    c.endpoints = out;
  }

  // 5) Remove orphan connections (from/to not in components)
  const validIds = new Set(dedupedComponents.map((c) => c.id));
  const cleanConnections: Connection[] = [];
  for (const conn of arch.connections ?? []) {
    if (!conn.from || !validIds.has(conn.from)) {
      changes.orphan_connections_removed.push({
        id: conn.id ?? `${conn.from}_to_${conn.to}`,
        reason: `from="${conn.from}" inexistant`,
      });
      continue;
    }
    if (!conn.to || !validIds.has(conn.to)) {
      changes.orphan_connections_removed.push({
        id: conn.id ?? `${conn.from}_to_${conn.to}`,
        reason: `to="${conn.to}" inexistant`,
      });
      continue;
    }
    cleanConnections.push(conn);
  }
  arch.connections = cleanConnections;

  // 6) Dedup connections by (from, to, protocol)
  const seenConnKey = new Set<string>();
  const dedupedConnections: Connection[] = [];
  for (const conn of arch.connections ?? []) {
    const key = `${conn.from}|${conn.to}|${conn.protocol ?? ''}`;
    if (seenConnKey.has(key)) {
      changes.duplicate_connections_removed.push(conn.id ?? key);
      continue;
    }
    seenConnKey.add(key);
    dedupedConnections.push(conn);
  }
  arch.connections = dedupedConnections;

  // 7) Remove orphan used_by entries
  for (const c of arch.components ?? []) {
    if (!Array.isArray(c.used_by)) continue;
    const filtered: string[] = [];
    for (const ref of c.used_by) {
      if (validIds.has(ref)) {
        filtered.push(ref);
      } else {
        changes.orphan_used_by_removed.push({ component: c.id, ref });
      }
    }
    c.used_by = filtered;
  }

  // 8) Remove orphan data_access entries
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      if (!Array.isArray(e.data_access)) continue;
      const filtered: typeof e.data_access = [];
      for (const da of e.data_access) {
        if (validIds.has(da.component_id)) {
          filtered.push(da);
        } else {
          changes.orphan_data_access_removed.push({ component: c.id, ref: da.component_id });
        }
      }
      e.data_access = filtered;
    }
  }

  // 9) Remove orphan warnings (component points to non-existent id, excluding "global")
  const cleanWarnings: Warning[] = [];
  for (const w of arch.warnings ?? []) {
    if (w.component === 'global' || validIds.has(w.component)) {
      cleanWarnings.push(w);
    } else {
      changes.orphan_warnings_removed.push({ component: w.component, message: w.message });
    }
  }
  if (cleanWarnings.length > 0 || (arch.warnings && arch.warnings.length > 0)) {
    arch.warnings = cleanWarnings;
  }

  // 10) Fix type global if FE+BE present and type doesn't reflect it
  if (options.fixTypeGlobal) {
    const hasFrontend = (arch.components ?? []).some((c) => c.type === 'frontend');
    const hasBackend = (arch.components ?? []).some((c) => c.type === 'backend');
    if (arch.type === 'BACKEND' && hasFrontend) {
      changes.type_global_fixed = { from: 'BACKEND', to: 'FULLSTACK' };
      arch.type = 'FULLSTACK';
    } else if (arch.type === 'FRONTEND' && hasBackend) {
      changes.type_global_fixed = { from: 'FRONTEND', to: 'FULLSTACK' };
      arch.type = 'FULLSTACK';
    }
  }

  // 11) Recompute flow_summary from the cleaned state (folded-in recompute_summary)
  const rs = recomputeSummary(arch as Parameters<typeof recomputeSummary>[0]);
  changes.summary_recomputed = { changed_fields: rs.changed_fields };

  return { changes };
}
