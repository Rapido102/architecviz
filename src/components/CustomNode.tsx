import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Monitor,
  Server,
  Database,
  Cloud,
  ExternalLink,
  Zap,
  ListOrdered,
  MessageSquare,
  Clock,
  Workflow,
  Shield,
  Activity,
  Globe,
  Box,
  Link2,
  Crosshair,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { ComponentType } from '../types';

const TYPE_ICONS: Record<ComponentType, React.ReactNode> = {
  frontend: <Monitor className="w-4 h-4" />,
  backend: <Server className="w-4 h-4" />,
  cache: <Zap className="w-4 h-4" />,
  db: <Database className="w-4 h-4" />,
  queue: <ListOrdered className="w-4 h-4" />,
  mq: <MessageSquare className="w-4 h-4" />,
  batch: <Clock className="w-4 h-4" />,
  etl: <Workflow className="w-4 h-4" />,
  iam: <Shield className="w-4 h-4" />,
  monitoring: <Activity className="w-4 h-4" />,
  service: <Cloud className="w-4 h-4" />,
  "third-party": <Globe className="w-4 h-4" />,
};

const TYPE_LABEL: Record<ComponentType, string> = {
  frontend: "Frontend",
  backend: "Backend",
  cache: "Cache",
  db: "Database",
  queue: "Queue",
  mq: "Message Broker",
  batch: "Batch Job",
  etl: "ETL / Pipeline",
  iam: "IAM",
  monitoring: "Monitoring",
  service: "Service",
  "third-party": "Third-Party",
};

export const CustomNode = memo(({ data, selected }: NodeProps) => {
  const type = data.type as string;
  const icon = TYPE_ICONS[type as ComponentType] ?? <Box className="w-4 h-4" />;
  const typeLabel = TYPE_LABEL[type as ComponentType] ?? type;
  const layerColor = data.layerColor as string;
  const routesCount = (data.routes as any[])?.length || 0;
  const endpointsCount = (data.endpoints as any[])?.length || 0;
  const severity = data.healthSeverity as 'CRITICAL' | 'WARNING' | 'INFO' | undefined;
  const healthIssues = (data.healthIssues as number) || 0;
  const healthScore = data.healthScore as number | undefined;
  const sevColor = severity === 'CRITICAL' ? 'bg-red-500' : severity === 'WARNING' ? 'bg-amber-400' : severity === 'INFO' ? 'bg-sky-400' : '';

  return (
    <div
      className={cn(
        "relative bg-white border-2 border-brand-line p-4 min-w-[240px] transition-all duration-200",
        selected && "border-brand-ink ring-4 ring-brand-ink/5",
        data.activeFlow && "border-purple-500 ring-4 ring-purple-300 shadow-lg scale-[1.02]"
      )}
    >
      {severity && (
        <div
          className={cn('absolute -top-2 -right-2 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-white text-[9px] font-mono font-bold border border-white', sevColor)}
          title={`${healthIssues} problème(s) — sévérité max ${severity}`}
        >
          {healthIssues}
        </div>
      )}

      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-brand-ink border-0" />

      {Boolean(data.networkArchName) && (
        <div className="-mx-4 -mt-4 mb-3 px-4 py-1 bg-brand-ink text-white text-[8px] font-mono uppercase tracking-wider truncate">
          {String(data.networkArchName)}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div
          className="p-2 border border-brand-line shrink-0"
          style={{ backgroundColor: layerColor }}
        >
          {icon}
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="text-[9px] uppercase font-mono opacity-50 tracking-wider mb-0.5">
            {data.layer as string}
          </div>
          <h3 className="font-bold text-sm truncate leading-tight mb-1">
            {data.label as string}
          </h3>
          <div className="flex gap-2 items-center">
             <div className="font-mono text-[9px] opacity-70 truncate px-1 bg-brand-bg border border-brand-line">
               {data.technology as string}
             </div>
             {data.build_tool && (
                <div className="text-[9px] opacity-40 font-mono">
                  {String(data.build_tool)}
                </div>
             )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
         <div className="flex flex-col">
            <span className="text-[8px] uppercase opacity-40 font-mono">Type</span>
            <span className="text-[9px] font-bold leading-none uppercase">{typeLabel}</span>
         </div>
         {routesCount > 0 && (
           <div className="flex flex-col">
              <span className="text-[8px] uppercase opacity-40 font-mono">Routes</span>
              <span className="text-xs font-mono font-bold leading-none">{routesCount}</span>
           </div>
         )}
         {endpointsCount > 0 && (
           <div className="flex flex-col">
              <span className="text-[8px] uppercase opacity-40 font-mono">Endpoints</span>
              <span className="text-xs font-mono font-bold leading-none">{endpointsCount}</span>
           </div>
         )}
         {typeof data.onNodeFlow === 'function' && (
           <button
             onClick={(e) => { e.stopPropagation(); (data.onNodeFlow as (id: string) => void)(data.id as string); }}
             className="ml-auto self-center flex items-center gap-1 text-[8px] uppercase font-mono border border-purple-300 text-purple-700 px-1.5 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
             title="Visualiser le parcours des données de ce composant"
           >
             <Crosshair className="w-2.5 h-2.5" /> parcours
           </button>
         )}
      </div>

      {Boolean(data.linkedArchId) && (
        <div
          className="mt-3 pt-3 border-t border-brand-line flex items-center gap-1.5 text-purple-700"
          title={`Architecture liée : ${String(data.linkedArchName)} — cliquez le nœud pour ouvrir`}
        >
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="text-[9px] font-mono uppercase font-bold truncate">↗ {String(data.linkedArchName)}</span>
        </div>
      )}

      {data.url && (
        <div className="mt-3 pt-3 border-t border-brand-line flex items-center gap-1 opacity-30 hover:opacity-100 transition-opacity">
          <ExternalLink className="w-3 h-3" />
          <span className="text-[9px] font-mono truncate">{String(data.url)}</span>
        </div>
      )}

      {typeof healthScore === 'number' && (
        <div className="mt-3 flex items-center gap-2" title={`Complétude ${healthScore}%`}>
          <div className="flex-1 h-1 bg-brand-bg border border-brand-line overflow-hidden">
            <div
              className={cn('h-full', healthScore >= 80 ? 'bg-green-500' : healthScore >= 50 ? 'bg-amber-400' : 'bg-red-500')}
              style={{ width: `${healthScore}%` }}
            />
          </div>
          <span className="text-[8px] font-mono opacity-40">{healthScore}%</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-brand-ink border-0" />
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
