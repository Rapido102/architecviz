import { useMemo, useState } from 'react';
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Crosshair,
  ArrowUpDown,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { ArchitectureConfig } from '../types';
import { flattenEndpoints, isValidated, opCategory, OP_STYLE, type FlatEndpoint } from '../core/explore';
import { validationStatus, VALIDATION_META, PROVENANCE_META, type Provenance } from '../core/status';

interface Props {
  config: ArchitectureConfig;
  onLineageEndpoint: (componentId: string, method: string, path: string) => void;
  onFocusComponent: (componentId: string) => void;
}

type SortKey = 'method' | 'path' | 'component' | 'access';
type AuthFilter = 'all' | 'auth' | 'public';
type ValFilter = 'all' | 'valid' | 'invalid';

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800',
  POST: 'bg-green-100 text-green-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
};

export function EndpointsView({ config, onLineageEndpoint, onFocusComponent }: Props) {
  const all = useMemo(() => flattenEndpoints(config), [config]);

  const [search, setSearch] = useState('');
  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [auth, setAuth] = useState<AuthFilter>('all');
  const [val, setVal] = useState<ValFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'component', dir: 1 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const availableMethods = useMemo(
    () => [...new Set(all.map((e) => e.method))].sort(),
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = all.filter((e) => {
      if (methods.size > 0 && !methods.has(e.method)) return false;
      if (auth === 'auth' && e.authenticated === false) return false;
      if (auth === 'public' && e.authenticated !== false) return false;
      if (val === 'valid' && !isValidated(e.validation)) return false;
      if (val === 'invalid' && isValidated(e.validation)) return false;
      if (q) {
        const hay = `${e.path} ${e.method} ${e.componentLabel} ${e.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sort.dir;
    rows = [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'method': return dir * a.method.localeCompare(b.method);
        case 'path': return dir * a.path.localeCompare(b.path);
        case 'component': return dir * (a.componentLabel.localeCompare(b.componentLabel) || a.path.localeCompare(b.path));
        case 'access': return dir * (a.dataAccessCount - b.dataAccessCount);
        default: return 0;
      }
    });
    return rows;
  }, [all, search, methods, auth, val, sort]);

  const stats = useMemo(() => {
    const validated = all.filter((e) => isValidated(e.validation)).length;
    const withVal = all.filter((e) => e.validation).length;
    const publicCount = all.filter((e) => e.authenticated === false).length;
    return { total: all.length, validated, withVal, publicCount, shown: filtered.length };
  }, [all, filtered.length]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const toggleMethod = (m: string) =>
    setMethods((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });

  const toggleExpand = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  return (
    <div className="h-full flex flex-col bg-brand-bg">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-brand-line bg-white px-6 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[16rem]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un endpoint, une page, une description…"
              className="w-full pl-9 pr-8 h-9 text-xs border border-brand-line bg-brand-bg focus:outline-none focus:border-brand-ink"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-brand-line">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Segmented
            value={auth}
            onChange={(v) => setAuth(v as AuthFilter)}
            options={[['all', 'Tous'], ['auth', 'Auth'], ['public', 'Public']]}
          />
          <Segmented
            value={val}
            onChange={(v) => setVal(v as ValFilter)}
            options={[['all', 'Validation'], ['valid', '✅ Validé'], ['invalid', '⚠️ Non validé']]}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono uppercase opacity-40 mr-1">Méthodes :</span>
          {availableMethods.map((m) => (
            <button
              key={m}
              onClick={() => toggleMethod(m)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-mono font-bold border transition-all',
                methods.has(m) || methods.size === 0
                  ? METHOD_STYLE[m] ?? 'bg-gray-100 text-gray-700'
                  : 'bg-white text-brand-ink/30 border-brand-line',
                methods.has(m) && 'ring-1 ring-brand-ink',
              )}
            >
              {m}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-4 text-[10px] font-mono opacity-60">
            <span>{stats.shown}/{stats.total} affichés</span>
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle className="w-3 h-3" /> {stats.validated} validés
            </span>
            {stats.publicCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="w-3 h-3" /> {stats.publicCount} publics
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-white border-b border-brand-line">
            <tr className="text-[9px] font-mono uppercase opacity-50">
              <Th onClick={() => toggleSort('method')} className="w-20">Méthode</Th>
              <Th onClick={() => toggleSort('path')}>Path</Th>
              <Th onClick={() => toggleSort('component')} className="w-48">Composant</Th>
              <th className="text-left font-normal px-2 py-2 w-20">Auth</th>
              <th className="text-left font-normal px-2 py-2 w-28">Validation</th>
              <Th onClick={() => toggleSort('access')} className="w-24">Accès données</Th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <EndpointRow
                key={e.key}
                e={e}
                expanded={expanded.has(e.key)}
                onToggle={() => toggleExpand(e.key)}
                onLineage={() => onLineageEndpoint(e.componentId, e.method, e.path)}
                onFocus={() => onFocusComponent(e.componentId)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-xs opacity-50">
                  Aucun endpoint ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EndpointRow({
  e,
  expanded,
  onToggle,
  onLineage,
  onFocus,
}: {
  e: FlatEndpoint;
  expanded: boolean;
  onToggle: () => void;
  onLineage: () => void;
  onFocus: () => void;
}) {
  const vstatus = validationStatus(e.validation);
  return (
    <>
      <tr
        className="border-b border-brand-line hover:bg-white cursor-pointer align-top"
        onClick={onToggle}
      >
        <td className="px-2 py-2">
          <span className={cn('text-[9px] font-bold px-1 py-0.5', METHOD_STYLE[e.method] ?? 'bg-gray-100 text-gray-700')}>
            {e.method}
          </span>
        </td>
        <td className="px-2 py-2 font-mono">{e.path}</td>
        <td className="px-2 py-2">
          <button
            onClick={(ev) => { ev.stopPropagation(); onFocus(); }}
            className="text-left hover:underline opacity-80"
            title="Voir le composant dans le graphe"
          >
            {e.componentLabel}
          </button>
        </td>
        <td className="px-2 py-2">
          {e.authenticated === false ? (
            <span className="text-[8px] bg-red-100 text-red-700 px-1 font-bold">PUBLIC</span>
          ) : (
            <span className="text-[8px] bg-brand-ink text-white px-1 font-bold">AUTH</span>
          )}
        </td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5">
            {vstatus !== 'none' && (
              <span className={cn(
                'text-[9px] font-mono',
                vstatus === 'valid' ? 'text-green-700' : vstatus === 'invalid' ? 'text-red-600' : 'text-amber-600',
              )}>
                {VALIDATION_META[vstatus].emoji} {VALIDATION_META[vstatus].label}
              </span>
            )}
            {e.provenance && (
              <span
                className="text-[8px] font-mono px-1 border border-brand-line opacity-60"
                title={PROVENANCE_META[e.provenance as Provenance]?.label}
              >
                {PROVENANCE_META[e.provenance as Provenance]?.short ?? e.provenance}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-2">
          {e.dataAccessCount > 0 ? (
            <button
              onClick={(ev) => { ev.stopPropagation(); onLineage(); }}
              className="flex items-center gap-1 text-[10px] font-mono border border-purple-300 text-purple-700 px-1.5 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
              title="Surligner le lineage dans le graphe"
            >
              <Crosshair className="w-2.5 h-2.5" /> {e.dataAccessCount}
            </button>
          ) : (
            <span className="text-[10px] opacity-30">—</span>
          )}
        </td>
        <td className="px-2 py-2 text-center opacity-40">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-brand-line bg-white/60">
          <td colSpan={7} className="px-6 py-3">
            <div className="space-y-3">
              {e.description && <p className="text-[11px] opacity-70 leading-relaxed">{e.description}</p>}

              <div className="flex flex-wrap gap-x-8 gap-y-1 text-[10px] font-mono opacity-70">
                {e.responseSchema && <span><span className="opacity-50">response:</span> {e.responseSchema}</span>}
                {e.statusCodes && e.statusCodes.length > 0 && (
                  <span><span className="opacity-50">status:</span> {e.statusCodes.join(', ')}</span>
                )}
              </div>

              {((e.requestFields?.length ?? 0) > 0 || (e.responseFields?.length ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {e.requestFields && e.requestFields.length > 0 && (
                    <FieldList title="Request" fields={e.requestFields} />
                  )}
                  {e.responseFields && e.responseFields.length > 0 && (
                    <FieldList title="Response" fields={e.responseFields} />
                  )}
                </div>
              )}

              {e.dataAccess.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] font-mono uppercase opacity-40">Accès données</div>
                  {e.dataAccess.map((da, i) => {
                    const cat = opCategory(da.operation);
                    return (
                      <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                        <span className={cn('px-1 py-0.5 font-bold border', OP_STYLE[cat])}>{da.operation}</span>
                        <span className="opacity-50">{da.component_id}</span>
                        <span className="opacity-90">{da.resource}</span>
                        {da.note && <span className="opacity-40 italic">— {da.note}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FieldList({ title, fields }: { title: string; fields: { name: string; type?: string; description?: string; required?: boolean }[] }) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase opacity-40 mb-1">{title} ({fields.length})</div>
      <div className="border border-brand-line bg-white">
        {fields.map((f, i) => (
          <div key={i} className="flex items-baseline gap-2 px-2 py-1 border-b border-brand-line last:border-0 text-[10px] font-mono">
            <span className="font-bold">{f.name}{f.required ? '' : '?'}</span>
            {f.type && <span className="opacity-50">{f.type}</span>}
            {f.description && <span className="opacity-40 truncate">{f.description}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Th({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <th className={cn('text-left font-normal px-2 py-2', className)}>
      <button onClick={onClick} className="flex items-center gap-1 hover:text-brand-ink uppercase">
        {children}
        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
      </button>
    </th>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex border border-brand-line">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'px-2.5 h-9 text-[10px] font-mono uppercase transition-colors border-r border-brand-line last:border-r-0',
            value === v ? 'bg-brand-ink text-white' : 'bg-white text-brand-ink hover:bg-brand-bg',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
