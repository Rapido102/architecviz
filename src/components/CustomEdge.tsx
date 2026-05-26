import React from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from '@xyflow/react';
import { cn } from '../lib/utils';
import { opCategory, OP_STYLE } from '../core/explore';
import type { FlowEdge, FlowLabel } from '../core/dataflow';

export const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const mappings = (data?.endpoint_mappings as any[]) || [];
  const endpoints = (data?.endpoints as any[]) || [];
  const hasDetails = mappings.length > 0 || endpoints.length > 0;

  const isFocused = data?.isFocused !== false;
  const flow = data?.flowEdge as FlowEdge | undefined;
  const active = !!(data as { activeFlow?: boolean } | undefined)?.activeFlow;
  const pathId = `fp-${id}`;

  return (
    <>
      {/* Active-step halo (driven by the sequence panel) */}
      {flow && active && (
        <path d={edgePath} fill="none" stroke="#7c3aed" strokeWidth={9} strokeOpacity={0.2} strokeLinecap="round" />
      )}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {/* Data-flow traversal — animated particles along this edge */}
      {flow && (
        <>
          <path id={pathId} d={edgePath} fill="none" stroke="none" />
          <circle r={active ? 6 : 4} fill="#7c3aed">
            <animateMotion dur={active ? '1.1s' : '1.6s'} repeatCount="indefinite" begin={`${(flow.order ?? 0) * 0.3}s`}>
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
          {flow.responseLabel && (
            <circle r={active ? 5 : 3.5} fill="#16a34a">
              <animateMotion dur={active ? '1.1s' : '1.6s'} repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear" begin={`${(flow.order ?? 0) * 0.3 + 0.8}s`}>
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>
          )}
        </>
      )}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            opacity: isFocused ? 1 : 0.4,
          }}
          className="nodrag nopan transition-opacity duration-300"
        >
          <div className={cn(
            "bg-white border border-brand-line px-2 py-1 flex flex-col items-center gap-0.5 min-w-[60px]",
            "hover:border-brand-ink transition-colors cursor-help group shadow-sm",
            active && "border-purple-500 ring-2 ring-purple-300"
          )}>
            <div className="text-[9px] font-mono font-bold leading-none uppercase">
                {String(label)}
            </div>

            {flow && flow.labels.length > 0 && (
              <div className="flex flex-col items-stretch gap-0.5 mt-1 max-w-[200px]">
                {flow.labels.slice(0, 4).map((l, i) => (
                  <FlowChip key={i} label={l} />
                ))}
                {flow.labels.length > 4 && (
                  <div className="text-[8px] opacity-40 font-mono text-center">+{flow.labels.length - 4}</div>
                )}
                {flow.responseLabel && (
                  <div className="text-[8px] font-mono text-green-700 truncate" title={flow.responseLabel}>
                    ↑ {flow.responseLabel}
                  </div>
                )}
              </div>
            )}

            {!flow && hasDetails && (
               <div className="text-[8px] opacity-40 font-mono">
                  {mappings.length > 0 ? `${mappings.length} MAPPINGS` : `${endpoints.length} CALLS`}
               </div>
            )}

            {/* Hover Tooltip Mini */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-50">
               <div className="bg-brand-ink text-white p-2 text-[8px] font-mono whitespace-nowrap border border-white/20 shadow-xl">
                  {mappings.slice(0, 3).map((m: any, i: number) => (
                    <div key={i} className="mb-1 last:mb-0">
                       <span className="opacity-50">{m.method}</span> {m.backend_endpoint}
                    </div>
                  ))}
                  {endpoints.slice(0, 3).map((e: any, i: number) => {
                    const isString = typeof e === 'string';
                    const parts = isString ? e.split(' ') : null;
                    const method = isString ? parts![0] : e.method;
                    const path = isString ? parts!.slice(1).join(' ') : e.path;
                    return (
                      <div key={i} className="mb-1 last:mb-0">
                         <span className="opacity-50">{method}</span> {path}
                      </div>
                    );
                  })}
                  {(mappings.length > 3 || endpoints.length > 3) && (
                    <div className="opacity-30">...and {Math.max(mappings.length, endpoints.length) - 3} more</div>
                  )}
               </div>
            </div>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

function FlowChip({ label }: { label: FlowLabel }) {
  if (label.operation) {
    const cat = opCategory(label.operation);
    return (
      <div className={cn('flex items-center gap-1 px-1 py-0.5 border text-[8px] font-mono leading-none', OP_STYLE[cat])} title={`${label.operation} ${label.text}`}>
        <span className="font-bold">{label.operation}</span>
        <span className="truncate">{label.text}</span>
      </div>
    );
  }
  const cls = label.kind === 'http' ? 'bg-brand-ink text-white border-brand-ink' : 'bg-white text-brand-ink border-brand-line';
  return (
    <div className={cn('px-1 py-0.5 border text-[8px] font-mono leading-none truncate', cls)} title={label.text}>
      {label.text}
    </div>
  );
}
