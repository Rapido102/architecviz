import { useMemo } from 'react';
import { Activity, AlertTriangle, AlertCircle, Info, CheckCircle, X, Database, Zap, Crosshair } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ArchitectureConfig } from '../types';
import { inspectArchitecture } from '../core/inspect';
import type { Issue, Severity } from '../core/inspect';

interface Props {
  config: ArchitectureConfig;
  onClose: () => void;
  onHighlightTable?: (dbComponentId: string, tableName: string) => void;
  onFocusComponent?: (componentId: string) => void;
  onGoToIssue?: (issue: Issue) => void;
}

const SEV_ORDER: Severity[] = ['CRITICAL', 'WARNING', 'INFO'];

const SEV_STYLE: Record<Severity, { icon: React.ReactNode; cls: string; chip: string }> = {
  CRITICAL: { icon: <AlertCircle className="w-3.5 h-3.5" />, cls: 'text-red-600', chip: 'bg-red-500 text-white' },
  WARNING: { icon: <AlertTriangle className="w-3.5 h-3.5" />, cls: 'text-amber-600', chip: 'bg-amber-400 text-black' },
  INFO: { icon: <Info className="w-3.5 h-3.5" />, cls: 'text-sky-600', chip: 'bg-sky-400 text-white' },
};

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

export function HealthPanel({ config, onClose, onHighlightTable, onFocusComponent, onGoToIssue }: Props) {
  const report = useMemo(() => inspectArchitecture(config), [config]);
  const { integrity, completeness, lineage } = report;

  const grouped = useMemo(() => {
    const g: Record<Severity, Issue[]> = { CRITICAL: [], WARNING: [], INFO: [] };
    for (const issue of integrity.issues) g[issue.severity].push(issue);
    return g;
  }, [integrity.issues]);

  const b = completeness.breakdown;

  return (
    <div className="w-[28rem] bg-white border-l border-brand-line flex flex-col h-full z-20 shadow-[-20px_0_40px_rgba(0,0,0,0.02)]">
      <div className="h-16 flex items-center justify-between px-6 border-b border-brand-line shrink-0">
        <h2 className="text-xs font-mono uppercase font-bold flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Santé de l'architecture
        </h2>
        <button onClick={onClose} className="p-1 hover:bg-brand-bg transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Score */}
        <section className="flex items-center gap-4">
          <div className={cn('text-4xl font-bold font-mono', scoreColor(completeness.overall_score))}>
            {completeness.overall_score}
            <span className="text-base opacity-40">/100</span>
          </div>
          <div className="flex-1 text-[11px] leading-tight opacity-70">
            Score de complétude de la cartographie.
            <div className="flex gap-2 mt-1 font-mono">
              {integrity.summary.critical > 0 && <span className="text-red-600">{integrity.summary.critical} critique(s)</span>}
              {integrity.summary.warnings > 0 && <span className="text-amber-600">{integrity.summary.warnings} warning(s)</span>}
              {integrity.summary.info > 0 && <span className="text-sky-600">{integrity.summary.info} info</span>}
              {integrity.issues.length === 0 && (
                <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> aucun problème</span>
              )}
            </div>
          </div>
        </section>

        {/* Completeness breakdown */}
        <section className="space-y-2">
          <h3 className="text-[10px] font-mono uppercase opacity-50 border-b border-brand-line pb-1">Complétude</h3>
          <Bar label="Endpoints avec data_access" value={b.endpoints_with_data_access_pct} count={`${b.endpoints_with_data_access}/${b.endpoints_total}`} />
          <Bar label="Routes avec api_calls" value={b.routes_with_api_calls_pct} count={`${b.routes_with_api_calls}/${b.routes_total}`} />
          <Bar label="Composants décrits" value={b.components_with_description_pct} count={`${b.components_with_description}/${b.components_total}`} />
          <Bar label="Versions précises" value={b.components_with_precise_versions_pct} count={`${b.components_with_precise_versions}/${b.components_total}`} />
          <Bar label="Tables documentées" value={b.tables_with_purpose_pct} count={`${b.tables_with_purpose}/${b.tables_total}`} />
          {b.placeholder_count > 0 && (
            <div className="text-[10px] opacity-60 pt-1">
              {b.placeholder_count} champ(s) « À confirmer »
            </div>
          )}
        </section>

        {/* Lineage signals */}
        {(lineage.hot_tables.length > 0 || lineage.dead_tables.length > 0 || lineage.chatty_endpoints.length > 0 || lineage.unauthenticated_endpoints_mutating.length > 0) && (
          <section className="space-y-2">
            <h3 className="text-[10px] font-mono uppercase opacity-50 border-b border-brand-line pb-1">Data lineage</h3>

            {lineage.hot_tables.map((t, i) => (
              <button
                key={`hot-${i}`}
                onClick={() => onHighlightTable?.(t.component_id, t.name)}
                className="w-full flex items-center gap-2 text-left text-[11px] p-2 border border-brand-line hover:bg-brand-bg transition-colors"
                title="Surligner les endpoints qui touchent cette table"
              >
                <Database className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span className="font-mono font-bold">{t.name}</span>
                <span className="opacity-60">touchée par {t.touched_by} endpoints</span>
                <Crosshair className="w-3 h-3 ml-auto opacity-40" />
              </button>
            ))}

            {lineage.dead_tables.length > 0 && (
              <div className="text-[10px] opacity-70">
                <span className="font-bold text-amber-600">Tables mortes</span> (jamais touchées) :{' '}
                {lineage.dead_tables.map((t) => `${t.name}`).join(', ')}
              </div>
            )}

            {lineage.chatty_endpoints.map((e, i) => (
              <div key={`chatty-${i}`} className="flex items-center gap-2 text-[11px] opacity-80">
                <Zap className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="font-mono">{e.method} {e.path}</span>
                <span className="opacity-60">{e.data_access_count} accès</span>
              </div>
            ))}

            {lineage.unauthenticated_endpoints_mutating.map((e, i) => (
              <div key={`unauth-${i}`} className="flex items-center gap-2 text-[11px] text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono">{e.method} {e.path}</span>
                <span>mutation non authentifiée</span>
              </div>
            ))}
          </section>
        )}

        {/* Issues */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-mono uppercase opacity-50 border-b border-brand-line pb-1">
            Problèmes ({integrity.issues.length})
          </h3>
          {integrity.issues.length === 0 && (
            <div className="text-[11px] text-green-600 flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> Aucun problème d'intégrité détecté.
            </div>
          )}
          {SEV_ORDER.map((sev) =>
            grouped[sev].map((issue, i) => (
              <div
                key={`${sev}-${i}`}
                className="border border-brand-line p-2"
              >
                <div className={cn('flex items-center gap-1.5 text-[10px] font-mono uppercase', SEV_STYLE[sev].cls)}>
                  {SEV_STYLE[sev].icon}
                  <span className={cn('px-1', SEV_STYLE[sev].chip)}>{sev}</span>
                  <span className="opacity-50">{issue.category}</span>
                  {issue.component && <span className="ml-auto opacity-60 truncate max-w-[8rem]">{issue.component}</span>}
                </div>
                <div className="text-[11px] mt-1 leading-tight">{issue.message}</div>
                {issue.suggestion && (
                  <div className="text-[10px] opacity-50 mt-1 leading-tight">→ {issue.suggestion}</div>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  {issue.component && issue.component !== 'global' && (
                    <button
                      onClick={() => onFocusComponent?.(issue.component!)}
                      className="text-[9px] uppercase font-mono border border-brand-line px-1.5 py-0.5 hover:bg-brand-ink hover:text-white transition-colors"
                    >
                      Focus
                    </button>
                  )}
                  <button
                    onClick={() => onGoToIssue?.(issue)}
                    className="text-[9px] uppercase font-mono border border-brand-line px-1.5 py-0.5 hover:bg-brand-ink hover:text-white transition-colors"
                    title="Ouvrir l'éditeur JSON sur le champ concerné"
                  >
                    → Champ
                  </button>
                </div>
              </div>
            )),
          )}
        </section>
      </div>
    </div>
  );
}

function Bar({ label, value, count }: { label: string; value: number; count: string }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 50 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="opacity-70">{label}</span>
        <span className="font-mono opacity-50">{count} · {value}%</span>
      </div>
      <div className="h-1.5 bg-brand-bg border border-brand-line overflow-hidden">
        <div className={cn('h-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
