import { useMemo, useState } from 'react';
import { Search, X, Crosshair, Database } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ArchitectureConfig } from '../types';
import {
  buildCrudMatrix,
  OP_LETTER,
  OP_STYLE,
  type OpCategory,
  type MatrixRow,
} from '../core/explore';

interface Props {
  config: ArchitectureConfig;
  onLineageEndpoint: (componentId: string, method: string, path: string) => void;
  onHighlightTable: (dbComponentId: string, tableName: string) => void;
}

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800',
  POST: 'bg-green-100 text-green-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
};

const CAT_ORDER: OpCategory[] = ['read', 'write', 'update', 'delete', 'other'];

export function CrudMatrix({ config, onLineageEndpoint, onHighlightTable }: Props) {
  const matrix = useMemo(() => buildCrudMatrix(config), [config]);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const sources = useMemo(() => {
    const ids = [...new Set(matrix.rows.map((r) => r.endpoint.componentId))];
    return ids.map((id) => ({ id, label: matrix.rows.find((r) => r.endpoint.componentId === id)!.endpoint.componentLabel }));
  }, [matrix.rows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matrix.rows.filter((r) => {
      if (sourceFilter !== 'all' && r.endpoint.componentId !== sourceFilter) return false;
      if (q) {
        const hay = `${r.endpoint.path} ${r.endpoint.method} ${r.endpoint.componentLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [matrix.rows, search, sourceFilter]);

  // Columns that still have at least one filled cell after row filtering.
  const visibleColumnKeys = useMemo(() => {
    const used = new Set<string>();
    for (const r of rows) for (const k of r.cells.keys()) used.add(k);
    return used;
  }, [rows]);

  const groups = useMemo(
    () =>
      matrix.groups
        .map((g) => ({ ...g, columnKeys: g.columnKeys.filter((k) => visibleColumnKeys.has(k)) }))
        .filter((g) => g.columnKeys.length > 0),
    [matrix.groups, visibleColumnKeys],
  );
  const columns = useMemo(
    () => groups.flatMap((g) => g.columnKeys.map((k) => matrix.columns.find((c) => c.key === k)!)),
    [groups, matrix.columns],
  );

  if (matrix.rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-brand-bg">
        <div className="text-center max-w-sm">
          <Database className="w-8 h-8 mx-auto opacity-20 mb-3" />
          <p className="text-xs opacity-50 leading-relaxed">
            Aucun endpoint ne déclare d'accès données (<span className="font-mono">data_access</span>) dans cette
            architecture. La matrice CRUD se base sur ce champ.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-brand-bg">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-brand-line bg-white px-6 py-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer les endpoints…"
            className="w-full pl-9 pr-8 h-9 text-xs border border-brand-line bg-brand-bg focus:outline-none focus:border-brand-ink"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-brand-line">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {sources.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 text-xs border border-brand-line bg-white px-2 focus:outline-none focus:border-brand-ink"
          >
            <option value="all">Tous les composants source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-2">
          {CAT_ORDER.filter((c) => c !== 'other').map((c) => (
            <span key={c} className={cn('flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border', OP_STYLE[c])}>
              <span className="font-bold">{OP_LETTER[c]}</span>
              {c === 'read' ? 'Read' : c === 'write' ? 'Create' : c === 'update' ? 'Update' : 'Delete'}
            </span>
          ))}
        </div>
        <span className="text-[10px] font-mono opacity-50">
          {rows.length} endpoints × {columns.length} ressources
        </span>
      </div>

      {/* Matrix */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            {/* Group header: target components */}
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-30 bg-white border border-brand-line px-3 py-2 text-left text-[9px] font-mono uppercase opacity-50 min-w-[18rem]"
              >
                Endpoint ↓ / Ressource →
              </th>
              {groups.map((g) => (
                <th
                  key={g.componentId}
                  colSpan={g.columnKeys.length}
                  className="bg-white border border-brand-line px-2 py-1.5 text-[9px] font-mono uppercase font-bold text-center"
                >
                  {g.componentLabel}
                </th>
              ))}
            </tr>
            {/* Resource header */}
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="bg-white border border-brand-line p-0 align-bottom"
                  title={`${col.resource} — ${col.touchedBy} endpoint(s)`}
                >
                  <button
                    onClick={() => onHighlightTable(col.componentId, col.resource.split('.').pop()?.replace(/[`"']/g, '') ?? col.resource)}
                    className="h-32 w-9 flex items-end justify-center pb-2 hover:bg-brand-bg transition-colors group"
                  >
                    <span className="[writing-mode:vertical-rl] rotate-180 font-mono text-[10px] whitespace-nowrap max-h-28 overflow-hidden group-hover:text-purple-700">
                      {col.resource}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MatrixRowView
                key={row.endpoint.key}
                row={row}
                columns={columns}
                onLineage={() => onLineageEndpoint(row.endpoint.componentId, row.endpoint.method, row.endpoint.path)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatrixRowView({
  row,
  columns,
  onLineage,
}: {
  row: MatrixRow;
  columns: { key: string }[];
  onLineage: () => void;
}) {
  const e = row.endpoint;
  return (
    <tr className="hover:bg-white/70 group">
      <th className="sticky left-0 z-10 bg-white group-hover:bg-white border border-brand-line px-3 py-1.5 text-left font-normal min-w-[18rem]">
        <div className="flex items-center gap-2">
          <span className={cn('text-[9px] font-bold px-1 py-0.5 shrink-0', METHOD_STYLE[e.method] ?? 'bg-gray-100 text-gray-700')}>
            {e.method}
          </span>
          <span className="font-mono text-[10px] truncate flex-1" title={`${e.componentLabel} — ${e.path}`}>{e.path}</span>
          <button
            onClick={onLineage}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-purple-700 hover:text-purple-900"
            title="Surligner le lineage dans le graphe"
          >
            <Crosshair className="w-3 h-3" />
          </button>
        </div>
      </th>
      {columns.map((col) => {
        const cats = row.cells.get(col.key);
        return (
          <td key={col.key} className="border border-brand-line p-0 text-center">
            {cats && cats.size > 0 ? (
              <div className="flex items-center justify-center gap-px h-full py-1">
                {CAT_ORDER.filter((c) => cats.has(c)).map((c) => (
                  <span
                    key={c}
                    className={cn('inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold border', OP_STYLE[c])}
                  >
                    {OP_LETTER[c]}
                  </span>
                ))}
              </div>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}
