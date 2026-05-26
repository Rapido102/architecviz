import { useEffect, useState } from 'react';
import { ListOrdered, X, ArrowRight, Pause, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { opCategory, OP_STYLE } from '../core/explore';
import type { DataFlow, FlowLabel, FlowEdge } from '../core/dataflow';

interface Props {
  flow: DataFlow;
  labels: Map<string, string>; // component id -> label
  onClose: () => void;
  /** Reports the step currently in focus (auto-advancing or hovered) for graph emphasis. */
  onFocusStep?: (edge: FlowEdge | null) => void;
}

const KIND_LABEL: Record<DataFlow['kind'], string> = {
  endpoint: 'Endpoint',
  resource: 'Ressource',
  route: 'Page',
  component: 'Composant',
};

export function SequencePanel({ flow, labels, onClose, onFocusStep }: Props) {
  const steps = flow.edges;
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  // Auto-advancing highlight, looping in step order — synced with the edge particles.
  useEffect(() => {
    setActive(0);
  }, [flow]);

  useEffect(() => {
    if (!playing || hovered !== null || steps.length === 0) return;
    const t = setInterval(() => setActive((a) => (a + 1) % steps.length), 1100);
    return () => clearInterval(t);
  }, [playing, hovered, steps.length]);

  // The step in focus = hovered if any, else the auto/clicked active one.
  const focusedIdx = hovered ?? active;
  useEffect(() => {
    onFocusStep?.(steps[focusedIdx] ?? null);
  }, [focusedIdx, steps, onFocusStep]);
  useEffect(() => () => onFocusStep?.(null), [onFocusStep]);

  const lbl = (id: string) => labels.get(id) ?? id;

  return (
    <aside className="w-[26rem] shrink-0 bg-white border-r border-brand-line flex flex-col h-full z-20">
      <div className="h-16 flex items-center justify-between px-5 border-b border-brand-line shrink-0">
        <div className="min-w-0">
          <h2 className="text-xs font-mono uppercase font-bold flex items-center gap-2">
            <ListOrdered className="w-4 h-4" /> Parcours
          </h2>
          <div className="text-[10px] font-mono opacity-50 truncate">
            {KIND_LABEL[flow.kind]} · {flow.title}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setPlaying((p) => !p)} className="p-1 hover:bg-brand-bg" title={playing ? 'Pause' : 'Lecture'}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-brand-bg" title="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {steps.length === 0 && (
          <div className="text-[11px] opacity-50 leading-relaxed">
            Aucune étape traçable (connexions ou data_access manquants pour ce parcours).
          </div>
        )}
        {steps.map((e, i) => (
          <button
            key={e.connectionId}
            onClick={() => { setPlaying(false); setActive(i); }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              'w-full text-left border p-2 transition-colors',
              i === focusedIdx ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-300' : 'border-brand-line hover:bg-brand-bg',
            )}
          >
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className={cn(
                'w-4 h-4 flex items-center justify-center text-[9px] font-mono font-bold shrink-0',
                i === focusedIdx ? 'bg-purple-600 text-white' : 'bg-brand-bg border border-brand-line',
              )}>
                {i + 1}
              </span>
              <span className="font-mono truncate">{lbl(e.from)}</span>
              <ArrowRight className="w-3 h-3 shrink-0 opacity-40" />
              <span className="font-mono truncate">{lbl(e.to)}</span>
            </div>
            <div className="flex flex-wrap gap-1 pl-6">
              {e.labels.map((l, j) => (
                <Chip key={j} label={l} />
              ))}
            </div>
            {e.responseLabel && (
              <div className="pl-6 mt-1 text-[9px] font-mono text-green-700 truncate">↑ {e.responseLabel}</div>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Chip({ label }: { label: FlowLabel }) {
  if (label.operation) {
    const cat = opCategory(label.operation);
    return (
      <span className={cn('px-1 py-0.5 border text-[9px] font-mono leading-none', OP_STYLE[cat])} title={`${label.operation} ${label.text}`}>
        <b>{label.operation}</b> {label.text}
      </span>
    );
  }
  const cls = label.kind === 'http' ? 'bg-brand-ink text-white border-brand-ink' : 'bg-white text-brand-ink border-brand-line';
  return (
    <span className={cn('px-1 py-0.5 border text-[9px] font-mono leading-none', cls)} title={label.text}>
      {label.text}
    </span>
  );
}
