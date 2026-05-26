// Rename a component_id everywhere in the architecture.

interface Architecture {
  type?: string;
  components?: Component[];
  connections?: Connection[];
  warnings?: Warning[];
}

interface Component {
  id: string;
  type?: string;
  used_by?: string[];
  endpoints?: Endpoint[];
  [key: string]: unknown;
}

interface Endpoint {
  data_access?: { component_id: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

interface Connection {
  id?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

interface Warning {
  component?: string;
  [key: string]: unknown;
}

export interface RenameResult {
  ok: boolean;
  reason?: string;
  changes: {
    component_renamed: boolean;
    connections_from: number;
    connections_to: number;
    connection_ids_regenerated: number;
    used_by_refs: number;
    data_access_refs: number;
    warnings_refs: number;
  };
}

function isValidId(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

export function renameComponent(
  arch: Architecture,
  oldId: string,
  newId: string,
): RenameResult {
  const changes = {
    component_renamed: false,
    connections_from: 0,
    connections_to: 0,
    connection_ids_regenerated: 0,
    used_by_refs: 0,
    data_access_refs: 0,
    warnings_refs: 0,
  };

  if (oldId === newId) {
    return { ok: false, reason: 'old_id and new_id are identical', changes };
  }
  if (!isValidId(newId)) {
    return { ok: false, reason: `new_id "${newId}" must match /^[a-z0-9_-]+$/i`, changes };
  }
  const components = arch.components ?? [];
  if (components.some((c) => c.id === newId)) {
    return { ok: false, reason: `new_id "${newId}" already exists — use consolidate instead`, changes };
  }
  const target = components.find((c) => c.id === oldId);
  if (!target) {
    return { ok: false, reason: `old_id "${oldId}" not found in components`, changes };
  }

  // 1) Rename the component itself
  target.id = newId;
  changes.component_renamed = true;

  // 2) Rename in used_by[] of all components
  for (const c of components) {
    if (!Array.isArray(c.used_by)) continue;
    c.used_by = c.used_by.map((id) => {
      if (id === oldId) {
        changes.used_by_refs++;
        return newId;
      }
      return id;
    });
  }

  // 3) Rename in endpoints[].data_access[].component_id
  for (const c of components) {
    for (const e of c.endpoints ?? []) {
      for (const da of e.data_access ?? []) {
        if (da.component_id === oldId) {
          da.component_id = newId;
          changes.data_access_refs++;
        }
      }
    }
  }

  // 4) Rename connections.from / .to + regenerate connection.id if it followed the convention
  for (const conn of arch.connections ?? []) {
    if (conn.from === oldId) {
      conn.from = newId;
      changes.connections_from++;
    }
    if (conn.to === oldId) {
      conn.to = newId;
      changes.connections_to++;
    }
    // Regenerate id if it matched the convention `<from>_to_<to>`
    if (typeof conn.id === 'string' && conn.from && conn.to) {
      const expected = `${conn.from}_to_${conn.to}`;
      const previousExpectedPatterns = [
        `${oldId}_to_${conn.to}`,
        `${conn.from}_to_${oldId}`,
      ];
      if (previousExpectedPatterns.includes(conn.id)) {
        conn.id = expected;
        changes.connection_ids_regenerated++;
      }
    }
  }

  // 5) Rename in warnings[].component (exact match only)
  for (const w of arch.warnings ?? []) {
    if (w.component === oldId) {
      w.component = newId;
      changes.warnings_refs++;
    }
  }

  return { ok: true, changes };
}
