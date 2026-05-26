import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Crosshair } from 'lucide-react';
import { cn } from '../lib/utils';

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700 border-blue-200',
  POST: 'bg-green-100 text-green-700 border-green-200',
  PUT: 'bg-amber-100 text-amber-700 border-amber-200',
  PATCH: 'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
};

export const EndpointNode = memo(({ data, selected }: NodeProps) => {
  const method = (data.method as string).toUpperCase();
  const methodStyle = METHOD_STYLE[method] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const authenticated = data.authenticated as boolean | undefined;
  const description = data.description as string | undefined;
  const onEndpointFlow = data.onEndpointFlow as ((compId: string, method: string, path: string) => void) | undefined;

  return (
    <div
      className={cn(
        'bg-white border border-brand-line px-2 py-1.5 min-w-[190px] flex items-center gap-2 transition-all duration-150',
        selected && 'border-brand-ink ring-2 ring-brand-ink/10',
        data.activeFlow && 'border-purple-400 ring-2 ring-purple-200',
      )}
      title={description}
    >
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !bg-brand-line !border-0" />
      <span className={cn('px-1 py.5 border text-[9px] font-mono font-bold uppercase shrink-0', methodStyle)}>
        {method}
      </span>
      <span className="text-[10px] font-mono truncate flex-1 opacity-75">{data.path as string}</span>
      {authenticated === false && (
        <span className="shrink-0 text-[8px] font-mono font-bold text-red-400 uppercase">pub</span>
      )}
      {onEndpointFlow && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEndpointFlow(data.parentCompId as string, data.method as string, data.path as string);
          }}
          className="shrink-0 flex items-center gap-0.5 text-[8px] uppercase font-mono border border-purple-300 text-purple-700 px-1 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
          title="Visualiser le parcours des données de cet endpoint"
        >
          <Crosshair className="w-2 h-2" />
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !bg-brand-line !border-0" />
    </div>
  );
});

EndpointNode.displayName = 'EndpointNode';
