import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import { Link2, Boxes } from 'lucide-react';
import { CustomNode } from './CustomNode';
import { CustomEdge } from './CustomEdge';
import { getLayoutedElements } from '../utils/layout';
import { cn } from '../lib/utils';
import type { ArchitectureEntry } from '../architectures';
import type { CrossLink } from '../core/crossLinks';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

const ns = (archId: string, compId: string) => `${archId}::${compId}`;

interface Props {
  registry: ArchitectureEntry[];
  crossLinks: CrossLink[];
  /** Open a component in the single-architecture graph view. */
  onOpenComponent: (archId: string, componentId: string) => void;
}

/** Pick the component of an architecture that best represents it as a link target. */
function representativeComponent(arch: ArchitectureEntry): string | undefined {
  const comps = arch.data.components ?? [];
  return (
    comps.find((c) => c.type === 'backend')?.id ??
    comps.find((c) => c.type === 'frontend')?.id ??
    comps[0]?.id
  );
}

export function NetworkView({ registry, crossLinks, onOpenComponent }: Props) {
  const [onlyConnected, setOnlyConnected] = useState(false);

  const { nodes, edges, stats } = useMemo(() => {
    // Which architectures participate in at least one cross-link?
    const connectedArchs = new Set<string>();
    for (const l of crossLinks) {
      connectedArchs.add(l.fromArchId);
      connectedArchs.add(l.toArchId);
    }

    const archs = onlyConnected ? registry.filter((a) => connectedArchs.has(a.id)) : registry;
    const archIds = new Set(archs.map((a) => a.id));

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    for (const arch of archs) {
      const layerColor = new Map<string, string>(
        (arch.data.layers ?? []).map((l) => [l.name, l.color]),
      );
      for (const comp of arch.data.components ?? []) {
        rawNodes.push({
          id: ns(arch.id, comp.id),
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            ...comp,
            layerColor: layerColor.get(comp.layer) || '#f3f4f6',
            networkArchId: arch.id,
            networkArchName: arch.name,
          },
        });
      }
      for (const conn of arch.data.connections ?? []) {
        rawEdges.push({
          id: ns(arch.id, conn.id),
          source: ns(arch.id, conn.from),
          target: ns(arch.id, conn.to),
          label: conn.protocol,
          type: 'custom',
          style: { stroke: '#141414', strokeWidth: 1.5, opacity: 0.35 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#14141455' },
          data: { ...conn, isFocused: false },
        });
      }
    }

    // Inter-architecture links.
    const repCache = new Map<string, string | undefined>();
    let crossCount = 0;
    for (const l of crossLinks) {
      if (!archIds.has(l.fromArchId) || !archIds.has(l.toArchId)) continue;
      const sourceId = ns(l.fromArchId, l.fromComponentId);
      const toArch = archs.find((a) => a.id === l.toArchId)!;
      if (!repCache.has(l.toArchId)) repCache.set(l.toArchId, representativeComponent(toArch));
      const repId = repCache.get(l.toArchId);
      if (!repId) continue;
      rawEdges.push({
        id: `xlink_${l.fromArchId}_${l.fromComponentId}_${l.toArchId}`,
        source: sourceId,
        target: ns(l.toArchId, repId),
        label: `↗ ${l.toArchName}`,
        type: 'custom',
        animated: true,
        zIndex: 10,
        style: { stroke: '#7c3aed', strokeWidth: 2.5, opacity: 0.95, strokeDasharray: '6 3' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7c3aed' },
        data: { isFocused: true, crossArch: true, confidence: l.confidence },
      });
      crossCount++;
    }

    const layouted = getLayoutedElements(rawNodes, rawEdges, 'LR');
    return {
      nodes: layouted.nodes,
      edges: layouted.edges,
      stats: { archs: archs.length, components: rawNodes.length, crossLinks: crossCount },
    };
  }, [registry, crossLinks, onlyConnected]);

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.05}
        className="bg-brand-bg"
        nodesDraggable={false}
        onNodeClick={(_, node) => {
          const archId = node.data?.networkArchId as string | undefined;
          const compId = (node.data as { id?: string })?.id;
          if (archId && compId) onOpenComponent(archId, compId);
        }}
      >
        <Background color="#14141414" gap={20} size={1} />
        <Controls className="!shadow-none !border-brand-line" />
        <MiniMap
          className="!bg-white !border-brand-line"
          nodeStrokeColor="#141414"
          nodeColor={(n: Node) => (n.data?.layerColor as string) || '#eee'}
        />

        <Panel position="top-left" className="bg-white/90 backdrop-blur-sm border border-brand-line p-3 max-w-xs">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50 flex items-center gap-1.5 mb-2">
            <Boxes className="w-3.5 h-3.5" /> Réseau d'architectures
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Stacks" value={stats.archs} />
            <Stat label="Composants" value={stats.components} />
            <Stat label="Liens" value={stats.crossLinks} accent />
          </div>
          <div className="flex items-center gap-2 mb-2 text-[10px]">
            <span className="inline-block w-6 border-t-2 border-dashed border-purple-600" />
            <span className="font-mono opacity-60 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> lien inter-architecture
            </span>
          </div>
          <label className="flex items-center gap-2 text-[10px] font-mono cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyConnected}
              onChange={(e) => setOnlyConnected(e.target.checked)}
              className="accent-brand-ink"
            />
            Afficher seulement les stacks reliées
          </label>
          <p className="text-[9px] opacity-50 mt-2 leading-tight">
            Cliquez un composant pour l'ouvrir dans sa propre architecture.
          </p>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="p-2 bg-brand-bg border border-brand-line">
      <div className="text-[9px] opacity-50">{label}</div>
      <div className={cn('text-lg font-mono leading-none', accent && 'text-purple-700')}>{value}</div>
    </div>
  );
}
