// Pure data-shaping helpers for the Endpoints view and the CRUD matrix.
// No React, no fs — given an ArchitectureConfig, returns flat structures the UI can render.

import type { ArchitectureConfig, DataAccess } from '../types';
import { validationStatus } from './status';

export type OpCategory = 'read' | 'write' | 'update' | 'delete' | 'other';

/** Map a raw operation string (SELECT, GET, INSERT, PATCH, PUBLISH…) to a CRUD-ish bucket. */
export function opCategory(op: string): OpCategory {
  const o = op.toUpperCase();
  if (/^(SELECT|GET|READ|SCAN|HEAD|CONSUME|SUBSCRIBE)/.test(o)) return 'read';
  if (/^(UPDATE|PATCH|MERGE)/.test(o)) return 'update';
  if (/^(DELETE|DEL|REMOVE|EXPIRE)/.test(o)) return 'delete';
  if (/^(INSERT|UPSERT|SET|POST|PUT|PUBLISH|SEND|CREATE|WRITE)/.test(o)) return 'write';
  return 'other';
}

/** Single letter shown in matrix cells, by category. */
export const OP_LETTER: Record<OpCategory, string> = {
  read: 'R',
  write: 'C',
  update: 'U',
  delete: 'D',
  other: '·',
};

/** Tailwind classes per category, shared by the table and the matrix. */
export const OP_STYLE: Record<OpCategory, string> = {
  read: 'bg-blue-50 text-blue-700 border-blue-200',
  write: 'bg-green-50 text-green-700 border-green-200',
  update: 'bg-amber-50 text-amber-700 border-amber-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
};

export interface FlatEndpoint {
  key: string;
  componentId: string;
  componentLabel: string;
  layer: string;
  method: string;
  path: string;
  description?: string;
  authenticated?: boolean;
  validation?: string;
  statusCodes?: number[];
  responseSchema?: string;
  params?: Record<string, string[]>;
  dataAccess: DataAccess[];
  dataAccessCount: number;
  provenance?: string;
  responseFields?: { name: string; type?: string; description?: string; required?: boolean }[];
  requestFields?: { name: string; type?: string; description?: string; required?: boolean }[];
}

/** Every endpoint across every component, flattened with its owning component. */
export function flattenEndpoints(arch: ArchitectureConfig): FlatEndpoint[] {
  const out: FlatEndpoint[] = [];
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      out.push({
        key: `${c.id}|${e.method}|${e.path}`,
        componentId: c.id,
        componentLabel: c.label,
        layer: c.layer,
        method: (e.method ?? '').toUpperCase(),
        path: e.path,
        description: e.description,
        authenticated: e.authenticated,
        validation: e.validation,
        statusCodes: e.status_codes,
        responseSchema: e.response_schema,
        params: e.params as Record<string, string[]> | undefined,
        dataAccess: e.data_access ?? [],
        dataAccessCount: (e.data_access ?? []).length,
        provenance: e.provenance,
        responseFields: e.response_fields,
        requestFields: e.request_fields,
      });
    }
  }
  return out;
}

/** True when a validation string denotes a validated endpoint. */
export function isValidated(validation?: string): boolean {
  return validationStatus(validation) === 'valid';
}

export interface MatrixColumn {
  key: string; // component_id::resource
  componentId: string;
  componentLabel: string;
  resource: string;
  touchedBy: number;
}

export interface MatrixRow {
  endpoint: FlatEndpoint;
  /** column key -> set of operation categories present */
  cells: Map<string, Set<OpCategory>>;
}

export interface CrudMatrix {
  columns: MatrixColumn[];
  /** column keys grouped by target component, in column order */
  groups: { componentId: string; componentLabel: string; columnKeys: string[] }[];
  rows: MatrixRow[];
}

/**
 * Build the endpoint × resource matrix from data_access.
 * Columns are distinct `component_id::resource` targets; rows are endpoints that
 * touch at least one resource. Cells hold the set of operation categories.
 */
export function buildCrudMatrix(arch: ArchitectureConfig): CrudMatrix {
  const componentLabel = new Map<string, string>();
  for (const c of arch.components ?? []) componentLabel.set(c.id, c.label);

  const colMeta = new Map<string, MatrixColumn>();
  const endpoints = flattenEndpoints(arch).filter((e) => e.dataAccessCount > 0);

  const rows: MatrixRow[] = endpoints.map((endpoint) => {
    const cells = new Map<string, Set<OpCategory>>();
    for (const da of endpoint.dataAccess) {
      const colKey = `${da.component_id}::${da.resource}`;
      if (!colMeta.has(colKey)) {
        colMeta.set(colKey, {
          key: colKey,
          componentId: da.component_id,
          componentLabel: componentLabel.get(da.component_id) ?? da.component_id,
          resource: da.resource,
          touchedBy: 0,
        });
      }
      const set = cells.get(colKey) ?? new Set<OpCategory>();
      set.add(opCategory(da.operation));
      cells.set(colKey, set);
    }
    for (const colKey of cells.keys()) colMeta.get(colKey)!.touchedBy += 1;
    return { endpoint, cells };
  });

  // Order columns: group by target component (most-touched first), resources alpha within.
  const columns = [...colMeta.values()];
  const groupTouch = new Map<string, number>();
  for (const col of columns) groupTouch.set(col.componentId, (groupTouch.get(col.componentId) ?? 0) + col.touchedBy);

  columns.sort((a, b) => {
    const gt = (groupTouch.get(b.componentId) ?? 0) - (groupTouch.get(a.componentId) ?? 0);
    if (gt !== 0) return gt;
    if (a.componentId !== b.componentId) return a.componentId.localeCompare(b.componentId);
    return a.resource.localeCompare(b.resource);
  });

  const groups: CrudMatrix['groups'] = [];
  for (const col of columns) {
    let g = groups.find((x) => x.componentId === col.componentId);
    if (!g) {
      g = { componentId: col.componentId, componentLabel: col.componentLabel, columnKeys: [] };
      groups.push(g);
    }
    g.columnKeys.push(col.key);
  }

  return { columns, groups, rows };
}
