// Consolidate (N→1) : merge several components into one, redirect all references,
// remove the absorbed components. Complements rename_component (1→1).

import { mergeListByIdentity } from '../core/merge.js';

const MISSING = 'À confirmer';

interface Architecture {
  type?: string;
  components?: Component[];
  connections?: Connection[];
  warnings?: Warning[];
  [key: string]: unknown;
}
interface Component {
  id: string;
  [key: string]: unknown;
}
interface Connection {
  id?: string;
  from?: string;
  to?: string;
  protocol?: string;
  [key: string]: unknown;
}
interface Warning {
  component?: string;
  [key: string]: unknown;
}

export interface ConsolidateResult {
  ok: boolean;
  reason?: string;
  target: string;
  absorbed: string[];
  changes: {
    fields_filled: string[];
    arrays_unioned: string[];
    refs_redirected: number;
    connections_deduped: number;
  };
}

const SCALAR_FIELDS = ['label', 'type', 'layer', 'technology', 'url', 'port', 'description', 'note', 'consumed_via', 'state_management', 'build_tool'];
const ARRAY_IDENTITY: Record<string, string[]> = {
  endpoints: ['method', 'path'],
  routes: ['path'],
  cached_data: ['key_pattern'],
  tables: ['name'],
};
const STRING_ARRAYS = ['used_by', 'key_dependencies'];
const NESTED_OBJECTS = ['authentication', 'deployment'];

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === MISSING;
}
function isValidId(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

function absorbInto(target: Component, source: Component, changes: ConsolidateResult['changes']): void {
  // Scalars: fill target's missing fields from source
  for (const f of SCALAR_FIELDS) {
    if (isMissing(target[f]) && !isMissing(source[f])) {
      target[f] = source[f];
      changes.fields_filled.push(`${f}←${source.id}`);
    }
  }
  // Arrays of objects: union by identity (target wins on conflict)
  for (const [field, identity] of Object.entries(ARRAY_IDENTITY)) {
    const t = Array.isArray(target[field]) ? (target[field] as Record<string, unknown>[]) : [];
    const s = Array.isArray(source[field]) ? (source[field] as Record<string, unknown>[]) : [];
    if (s.length === 0) continue;
    const { merged } = mergeListByIdentity(s, t, identity); // incoming=target wins
    target[field] = merged;
    if (!changes.arrays_unioned.includes(field)) changes.arrays_unioned.push(field);
  }
  // String arrays: dedupe union
  for (const field of STRING_ARRAYS) {
    const t = Array.isArray(target[field]) ? (target[field] as string[]) : [];
    const s = Array.isArray(source[field]) ? (source[field] as string[]) : [];
    if (s.length === 0) continue;
    target[field] = Array.from(new Set([...t, ...s]));
    if (!changes.arrays_unioned.includes(field)) changes.arrays_unioned.push(field);
  }
  // Nested objects: fill missing sub-fields
  for (const field of NESTED_OBJECTS) {
    const sObj = source[field] as Record<string, unknown> | undefined;
    if (!sObj || typeof sObj !== 'object') continue;
    const tObj = (target[field] as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(sObj)) {
      if (isMissing(tObj[k]) && !isMissing(v)) tObj[k] = v;
    }
    target[field] = tObj;
  }
}

function redirectRefs(arch: Architecture, fromId: string, toId: string, changes: ConsolidateResult['changes']): void {
  for (const conn of arch.connections ?? []) {
    if (conn.from === fromId) { conn.from = toId; changes.refs_redirected++; }
    if (conn.to === fromId) { conn.to = toId; changes.refs_redirected++; }
  }
  for (const c of arch.components ?? []) {
    if (Array.isArray(c.used_by)) {
      c.used_by = (c.used_by as string[]).map((x) => {
        if (x === fromId) { changes.refs_redirected++; return toId; }
        return x;
      });
    }
    for (const e of (c.endpoints as { data_access?: { component_id: string }[] }[] | undefined) ?? []) {
      for (const da of e.data_access ?? []) {
        if (da.component_id === fromId) { da.component_id = toId; changes.refs_redirected++; }
      }
    }
  }
  for (const w of arch.warnings ?? []) {
    if (w.component === fromId) { w.component = toId; changes.refs_redirected++; }
  }
}

export function consolidateComponents(arch: Architecture, sourceIds: string[], targetId: string): ConsolidateResult {
  const changes: ConsolidateResult['changes'] = { fields_filled: [], arrays_unioned: [], refs_redirected: 0, connections_deduped: 0 };
  const empty = (reason: string): ConsolidateResult => ({ ok: false, reason, target: targetId, absorbed: [], changes });

  if (!isValidId(targetId)) return empty(`target_id "${targetId}" invalide (attendu [a-z0-9_-]+)`);
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return empty('source_ids vide');

  const components = arch.components ?? [];
  const byId = new Map(components.map((c) => [c.id, c]));

  // Validate all sources exist
  const missing = sourceIds.filter((id) => !byId.has(id));
  if (missing.length > 0) return empty(`composant(s) source inexistant(s) : ${missing.join(', ')}`);

  // Determine survivor
  let survivor: Component;
  let absorbed: string[];
  if (byId.has(targetId)) {
    survivor = byId.get(targetId)!;
    absorbed = sourceIds.filter((id) => id !== targetId);
  } else {
    // New id : first source becomes the survivor, renamed to targetId
    const firstId = sourceIds[0];
    survivor = byId.get(firstId)!;
    const oldId = survivor.id;
    survivor.id = targetId;
    redirectRefs(arch, oldId, targetId, changes);
    absorbed = sourceIds.slice(1);
  }

  if (absorbed.length === 0) return empty('rien à consolider (un seul composant ciblé)');

  // Absorb each source into the survivor, then redirect its refs and remove it
  for (const sid of absorbed) {
    const source = byId.get(sid)!;
    absorbInto(survivor, source, changes);
    redirectRefs(arch, sid, targetId, changes);
  }

  // Remove absorbed components
  arch.components = components.filter((c) => !absorbed.includes(c.id));

  // Dedup connections by (from, to, protocol) after redirect, regenerate convention ids
  const conns = (arch.connections ?? []) as Record<string, unknown>[];
  const before = conns.length;
  for (const conn of conns) {
    if (typeof conn.id === 'string' && conn.from && conn.to) {
      conn.id = `${conn.from}_to_${conn.to}`;
    }
  }
  const { merged } = mergeListByIdentity([], conns, ['from', 'to', 'protocol']);
  arch.connections = merged as unknown as Connection[];
  changes.connections_deduped = before - merged.length;

  return { ok: true, target: targetId, absorbed, changes };
}
