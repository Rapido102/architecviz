/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  Panel,
  ReactFlowProvider,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Code2,
  ShieldAlert,
  ArrowRight,
  Search,
  X,
  FileJson,
  Save,
  CheckCircle,
  AlertCircle,
  SquarePen,
  Activity,
  Crosshair,
  Database,
  Network,
  List,
  Grid3x3,
  Link2,
  Boxes,
  Eye,
  EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { ArchitectureConfig, Component, Connection as ArchConnection } from './types.ts';
import { architectures, defaultArchitecture } from './architectures';
import { CustomNode } from './components/CustomNode.tsx';
import { CustomEdge } from './components/CustomEdge.tsx';
import { EndpointNode } from './components/EndpointNode.tsx';
import { JsonEditor } from './components/JsonEditor.tsx';
import { ArchitectureEditor } from './components/architectureEditor/ArchitectureEditor.tsx';
import { HealthPanel } from './components/HealthPanel.tsx';
import { EndpointsView } from './components/EndpointsView.tsx';
import { CrudMatrix } from './components/CrudMatrix.tsx';
import { NetworkView } from './components/NetworkView.tsx';
import { componentHealth, type LineageHighlight, type ComponentHealth, type Issue } from './core/inspect';
import { dataFlowForEndpoint, dataFlowForResource, dataFlowForRoute, dataFlowForComponent, type DataFlow, type FlowEdge } from './core/dataflow';
import { SequencePanel } from './components/SequencePanel.tsx';
import { resolveCrossLinks, linksByComponent, neighborsOf, type CrossLink } from './core/crossLinks';
import { expandArchitecture } from './core/federate';
import { validationStatus, VALIDATION_META, PROVENANCE_META, type Provenance } from './core/status';
import { getLayoutedElements } from './utils/layout.ts';
import { useDebouncedValue } from './hooks/useDebouncedValue.ts';
import { cn } from './lib/utils.ts';
import { stripJsonComments } from './lib/stripJsonComments.ts';

const nodeTypes = {
  custom: CustomNode,
  endpoint: EndpointNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

export default function App() {
  const [selectedArchId, setSelectedArchId] = useState<string>(defaultArchitecture.id);
  const [jsonData, setJsonData] = useState<string>(JSON.stringify(defaultArchitecture.data, null, 2));
  const debouncedJson = useDebouncedValue(jsonData, 300);
  const [config, setConfig] = useState<ArchitectureConfig>(defaultArchitecture.data);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(new Set((defaultArchitecture.data.layers ?? []).map(l => l.name)));
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedElement, setSelectedElement] = useState<{ type: 'node' | 'edge'; data: any } | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isFormEditorOpen, setIsFormEditorOpen] = useState(false);
  const [isHealthOpen, setIsHealthOpen] = useState(false);
  const [dataFlow, setDataFlow] = useState<DataFlow | null>(null);
  const [activeFlowEdge, setActiveFlowEdge] = useState<FlowEdge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFlowSummary, setShowFlowSummary] = useState(() => {
    try { return localStorage.getItem('av:showFlowSummary') !== 'false'; } catch { return true; }
  });
  const [showLayersLegend, setShowLayersLegend] = useState(() => {
    try { return localStorage.getItem('av:showLayersLegend') !== 'false'; } catch { return true; }
  });
  const [endpointMode, setEndpointMode] = useState<'compact' | 'detailed'>(() => {
    try { return (localStorage.getItem('av:endpointMode') as 'compact' | 'detailed') ?? 'compact'; } catch { return 'compact'; }
  });
  const [view, setView] = useState<'graph' | 'endpoints' | 'data' | 'network'>('graph');

  // Cross-architecture links — resolved once over the whole registry.
  const crossLinks = useMemo<CrossLink[]>(
    () => resolveCrossLinks(architectures.map((a) => ({ id: a.id, name: a.name, data: a.data }))),
    [],
  );
  const currentLinks = useMemo(() => linksByComponent(crossLinks, selectedArchId), [crossLinks, selectedArchId]);
  const neighbors = useMemo(() => neighborsOf(crossLinks, selectedArchId), [crossLinks, selectedArchId]);

  // Linked architectures grafted inline onto the current graph.
  const [expandedArchs, setExpandedArchs] = useState<Set<string>>(new Set());
  const mergedGraph = useMemo(
    () => expandArchitecture(config, selectedArchId, architectures, crossLinks, expandedArchs),
    [config, selectedArchId, crossLinks, expandedArchs],
  );
  const health = useMemo(() => componentHealth(config), [config]);
  const [showHealthOverlay, setShowHealthOverlay] = useState(true);

  const toggleExpandArch = useCallback((archId: string) => {
    setExpandedArchs((prev) => {
      const next = new Set(prev);
      next.has(archId) ? next.delete(archId) : next.add(archId);
      return next;
    });
  }, []);

  // Save state
  const savedJsonRef = useRef<string>(JSON.stringify(defaultArchitecture.data, null, 2));
  const [isDirty, setIsDirty] = useState(false);
  const [schemaErrorCount, setSchemaErrorCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleArchitectureChange = useCallback((id: string) => {
    const arch = architectures.find(a => a.id === id);
    if (!arch) return;
    const clean = JSON.stringify(arch.data, null, 2);
    savedJsonRef.current = clean;
    setSelectedArchId(id);
    setJsonData(clean);
    setConfig(arch.data);
    setVisibleLayers(new Set((arch.data.layers ?? []).map(l => l.name)));
    setSelectedElement(null);
    setIsDirty(false);
    setSaveStatus('idle');
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty || !!error || schemaErrorCount > 0) return;
    const arch = architectures.find(a => a.id === selectedArchId);
    if (!arch) return;

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/save-architecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: arch.fileName, content: jsonData }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Erreur serveur');
      savedJsonRef.current = jsonData;
      setIsDirty(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [isDirty, error, schemaErrorCount, selectedArchId, jsonData]);

  useEffect(() => {
    setIsDirty(jsonData !== savedJsonRef.current);
  }, [jsonData]);

  // Collapse grafted architectures when switching to a different architecture.
  useEffect(() => {
    setExpandedArchs(new Set());
  }, [selectedArchId]);

  const handleFormChange = useCallback((next: ArchitectureConfig) => {
    setConfig(next);
    setJsonData(JSON.stringify(next, null, 2));
  }, []);

  const handleResetUnsaved = useCallback(() => {
    const clean = savedJsonRef.current;
    setJsonData(clean);
    try {
      setConfig(JSON.parse(stripJsonComments(clean)) as ArchitectureConfig);
    } catch {
      /* noop */
    }
    setSaveStatus('idle');
  }, []);

  const [endpointCtx, setEndpointCtx] = useState<{ compId: string; method: string; path: string } | null>(null);

  const handleLineageEndpoint = useCallback((componentId: string, method: string, path: string) => {
    setDataFlow(dataFlowForEndpoint(config, componentId, method, path));
    setEndpointCtx({ compId: componentId, method: method.toUpperCase(), path });
    setView('graph');
  }, [config]);

  const handleLineageTable = useCallback((dbComponentId: string, tableName: string) => {
    setDataFlow(dataFlowForResource(config, dbComponentId, tableName));
    setView('graph');
  }, [config]);

  const handleFocusComponent = useCallback((componentId: string) => {
    setSelectedElement({ type: 'node', data: (config.components ?? []).find(c => c.id === componentId) ?? { id: componentId } });
    setView('graph');
  }, [config]);

  const clearLineage = useCallback(() => { setDataFlow(null); setEndpointCtx(null); }, []);
  const flowHighlight = useMemo<LineageHighlight | null>(
    () => (dataFlow ? { componentIds: dataFlow.componentIds, connectionIds: dataFlow.connectionIds } : null),
    [dataFlow],
  );
  const componentLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of config.components ?? []) m.set(c.id, c.label);
    return m;
  }, [config]);

  const handleRouteFlow = useCallback((frontendId: string, routePath: string) => {
    setDataFlow(dataFlowForRoute(config, frontendId, routePath));
    setView('graph');
  }, [config]);

  const handleNodeFlow = useCallback((componentId: string) => {
    setDataFlow(dataFlowForComponent(config, componentId));
    setView('graph');
  }, [config]);

  const [reveal, setReveal] = useState<{ text: string; nonce: number } | null>(null);
  const handleGoToIssue = useCallback((issue: Issue) => {
    const m = issue.message.match(/[«"]([^«»"]{2,}?)[»"]/);
    const text = m?.[1] ?? (issue.component && issue.component !== 'global' ? issue.component : '');
    if (text) setReveal({ text, nonce: Date.now() });
    setIsEditorOpen(true);
  }, []);

  const handleOpenFromNetwork = useCallback((archId: string, componentId: string) => {
    if (archId !== selectedArchId) handleArchitectureChange(archId);
    const target = architectures.find((a) => a.id === archId);
    const comp = (target?.data.components ?? []).find((c) => c.id === componentId);
    setSelectedElement({ type: 'node', data: comp ?? { id: componentId } });
    setView('graph');
  }, [selectedArchId, handleArchitectureChange]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(stripJsonComments(debouncedJson)) as ArchitectureConfig;
      setConfig(parsed);
      setError(null);
    } catch {
      setError("JSON invalide — la dernière version valide est conservée");
    }
  }, [debouncedJson]);

  const updateGraph = useCallback((data: ArchitectureConfig, focusedLayers: Set<string>, lineageHighlight: LineageHighlight | null, links: Map<string, CrossLink>, archNameById: Map<string, string>, crossConnIds: Set<string>, healthByComponent: Map<string, ComponentHealth>, healthOverlay: boolean, flowByConn: Map<string, FlowEdge> | null, onNodeFlow: (id: string) => void, epMode: 'compact' | 'detailed', onEndpointFlow: (compId: string, method: string, path: string) => void, epCtx: { compId: string; method: string; path: string } | null) => {
    try {
      const lineageActive = !!lineageHighlight;
      const initialNodes: Node[] = data.components.map((comp) => {
        const layer = (data.layers ?? []).find(l => l.name === comp.layer);
        const inLineage = lineageHighlight?.componentIds.has(comp.id) ?? false;
        const foreignArch = archNameById.get(comp.id);
        // Grafted (foreign) nodes are always shown; lineage mode overrides layer-focus.
        const isFocused = lineageActive ? inLineage : (foreignArch ? true : focusedLayers.has(comp.layer));
        const link = links.get(comp.id);
        const h = !foreignArch && healthOverlay ? healthByComponent.get(comp.id) : undefined;
        return {
          id: comp.id,
          type: 'custom',
          data: {
            ...comp,
            layerColor: layer?.color || '#f3f4f6',
            isFocused,
            inLineage: lineageActive ? inLineage : undefined,
            linkedArchId: link?.toArchId,
            linkedArchName: link?.toArchName,
            networkArchName: foreignArch,
            healthSeverity: h?.severity ?? undefined,
            healthIssues: h?.issues ?? 0,
            healthScore: h ? h.completeness : undefined,
            onNodeFlow: foreignArch ? undefined : onNodeFlow,
          },
          style: { opacity: isFocused ? 1 : (lineageActive ? 0.12 : 0.3) },
          position: { x: 0, y: 0 },
        };
      });

      // Lookup: "${compId}|||${METHOD}|||${path}" → endpoint node id (detailed mode only)
      const epLookup = new Map<string, string>();
      // Tracks ep node IDs that are linked as intermediate nodes in a cross-component connection
      const linkedEpIds = new Set<string>();

      if (epMode === 'detailed') {
        data.components.forEach((comp) => {
          comp.endpoints?.forEach((ep, idx) => {
            epLookup.set(`${comp.id}|||${ep.method.toUpperCase()}|||${ep.path}`, `__ep__${comp.id}__${idx}`);
          });
        });
      }

      const ownershipEdgeStyle = { stroke: '#141414', strokeWidth: 1, strokeDasharray: '4 3' };

      const initialEdges: Edge[] = data.connections.flatMap((conn) => {
        const sourceNode = data.components.find(c => c.id === conn.from);
        const targetNode = data.components.find(c => c.id === conn.to);
        const isCross = crossConnIds.has(conn.id);
        const bothForeign = archNameById.has(conn.from) && archNameById.has(conn.to);
        const layerFocused = sourceNode && targetNode && focusedLayers.has(sourceNode.layer) && focusedLayers.has(targetNode.layer);
        const inLineage = lineageHighlight?.connectionIds.has(conn.id) ?? false;
        // Grafted edges (cross-arch links, foreign intra-edges) stay visible.
        const isFocused = lineageActive ? inLineage : (isCross || bothForeign || !!layerFocused);
        const purple = (lineageActive && inLineage) || isCross;

        const edgeStyle = {
          stroke: purple ? '#7c3aed' : '#141414',
          strokeWidth: purple ? 3 : 2,
          strokeDasharray: isCross ? '6 3' : undefined,
          opacity: isFocused ? 1 : 0.15,
        };
        const edgeMarker = {
          type: MarkerType.ArrowClosed,
          color: isFocused ? (purple ? '#7c3aed' : '#141414') : '#14141422',
        };
        const edgeData = { ...conn, isFocused, crossArch: isCross, flowEdge: flowByConn?.get(conn.id) };

        if (epMode === 'detailed') {
          // Model: caller → [endpoint] → owner  (composant ⇒ endpoint ⇒ composant)
          // feStr: "METHOD /path" (optional, from source side)
          // beStr: "/path", beMethod: "METHOD" (target endpoint, on conn.to)
          const resolveChain = (feStr: string | undefined, beStr: string, beMethod: string, idx: number): Edge[] | null => {
            const epId = epLookup.get(`${conn.to}|||${beMethod.toUpperCase()}|||${beStr}`);
            if (!epId) return null;
            linkedEpIds.add(epId);

            let srcId: string = conn.from;
            if (feStr) {
              const sp = feStr.indexOf(' ');
              if (sp !== -1) {
                const feMethod = feStr.slice(0, sp).toUpperCase();
                const fePath = feStr.slice(sp + 1);
                srcId = epLookup.get(`${conn.from}|||${feMethod}|||${fePath}`) ?? conn.from;
              }
            }

            // When a specific endpoint is targeted by lineage, only highlight its matching edges.
            // Inbound connections to the target component are filtered per-mapping;
            // outbound connections (data_access) keep the connection-level focus.
            let epIsFocused = isFocused;
            if (epCtx && lineageActive && isFocused && conn.to === epCtx.compId) {
              epIsFocused = beMethod.toUpperCase() === epCtx.method && beStr === epCtx.path;
            }
            const epStyle = { ...edgeStyle, opacity: epIsFocused ? 1 : (lineageActive ? 0.05 : 0.15) };
            const epMarker = { type: MarkerType.ArrowClosed, color: epIsFocused ? (purple ? '#7c3aed' : '#141414') : '#14141411' };

            return [
              // caller → endpoint
              {
                id: `${conn.id}__epl_call__${idx}`,
                source: srcId,
                target: epId,
                label: conn.protocol,
                type: 'custom',
                animated: epIsFocused,
                style: epStyle,
                markerEnd: epMarker,
                data: edgeData,
              },
              // endpoint → owner  (thin dashed, shows ownership)
              {
                id: `${conn.id}__epl_own__${idx}`,
                source: epId,
                target: conn.to,
                type: 'custom',
                style: { ...ownershipEdgeStyle, opacity: epIsFocused ? 0.6 : (lineageActive ? 0.05 : 0.15) },
                animated: false,
                markerEnd: { type: MarkerType.ArrowClosed, color: epIsFocused ? '#141414' : '#14141422' },
              },
            ];
          };

          const epEdges: Edge[] = [];
          (conn.endpoint_mappings ?? []).forEach((m, i) => {
            const chain = resolveChain(m.frontend_endpoint, m.backend_endpoint, m.method, i);
            if (chain) epEdges.push(...chain);
          });
          if (epEdges.length === 0) {
            (conn.endpoints ?? []).forEach((ep, i) => {
              const chain = resolveChain(ep.frontend_call, ep.backend_endpoint, ep.method, i);
              if (chain) epEdges.push(...chain);
            });
          }
          if (epEdges.length > 0) return epEdges;
          // No endpoint resolution → fall through to component-level edge
        }

        return [{
          id: conn.id,
          source: conn.from,
          target: conn.to,
          label: conn.protocol,
          type: 'custom',
          animated: isFocused,
          style: edgeStyle,
          markerEnd: edgeMarker,
          data: edgeData,
        }];
      });

      if (epMode === 'detailed') {
        data.components.forEach((comp) => {
          if (!comp.endpoints?.length) return;
          const parentNode = initialNodes.find((n) => n.id === comp.id);
          const parentOpacity = parentNode ? (parentNode.style?.opacity ?? 1) : 1;
          comp.endpoints.forEach((ep, idx) => {
            const epId = `__ep__${comp.id}__${idx}`;
            // Per-endpoint opacity: when lineage targets a specific endpoint, fade all others.
            let epOpacity = parentOpacity;
            if (epCtx && lineageActive) {
              const isTarget = comp.id === epCtx.compId &&
                ep.method.toUpperCase() === epCtx.method &&
                ep.path === epCtx.path;
              epOpacity = isTarget ? 1 : (lineageHighlight?.componentIds.has(comp.id) ? 0.15 : 0.05);
            }
            initialNodes.push({
              id: epId,
              type: 'endpoint',
              data: {
                method: ep.method,
                path: ep.path,
                authenticated: ep.authenticated,
                description: ep.description,
                parentCompId: comp.id,
                onEndpointFlow,
              },
              style: { opacity: epOpacity },
              position: { x: 0, y: 0 },
            });
            // Orphan endpoints (no cross-component connection) are shown below their owner
            if (!linkedEpIds.has(epId)) {
              initialEdges.push({
                id: `__ep_edge__${comp.id}__${idx}`,
                source: comp.id,
                target: epId,
                type: 'custom',
                style: ownershipEdgeStyle,
                markerEnd: { type: MarkerType.ArrowClosed, color: '#141414' },
                animated: false,
              });
            }
          });
        });
      }

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        initialNodes,
        initialEdges
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to generate graph layout. Please check your data structure.");
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    const data = { ...config, components: mergedGraph.components, connections: mergedGraph.connections, layers: mergedGraph.layers };
    updateGraph(data, visibleLayers, flowHighlight, currentLinks, mergedGraph.archNameById, mergedGraph.crossConnIds, health, showHealthOverlay, dataFlow?.byConnId ?? null, handleNodeFlow, endpointMode, handleLineageEndpoint, endpointCtx);
  }, [config, updateGraph, visibleLayers, flowHighlight, currentLinks, mergedGraph, health, showHealthOverlay, dataFlow, handleNodeFlow, endpointMode, handleLineageEndpoint, endpointCtx]);

  // Emphasize the active flow step's edge + its endpoints on the graph — style/data
  // only, no re-layout (avoids reshuffling node positions on every step).
  useEffect(() => {
    const a = activeFlowEdge;
    const connId = a?.connectionId ?? null;
    setEdges((eds) => eds.map((e) => {
      const on = !!connId && e.id === connId;
      if (!!(e.data as { activeFlow?: boolean } | undefined)?.activeFlow === on) return e;
      return { ...e, data: { ...e.data, activeFlow: on } };
    }));
    setNodes((nds) => nds.map((n) => {
      const on = !!a && (n.id === a.from || n.id === a.to);
      if (!!(n.data as { activeFlow?: boolean } | undefined)?.activeFlow === on) return n;
      return { ...n, data: { ...n.data, activeFlow: on } };
    }));
  }, [activeFlowEdge, setEdges, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const onNodeClick = (_: any, node: Node) => {
    setSelectedElement({ type: 'node', data: node.data });
  };

  const onEdgeClick = (_: any, edge: Edge) => {
    setSelectedElement({ type: 'edge', data: edge.data });
  };

  const toggleLayer = (layerName: string) => {
    setVisibleLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerName)) {
        if (next.size > 1) { // Prevent hiding all layers
          next.delete(layerName);
        }
      } else {
        next.add(layerName);
      }
      return next;
    });
  };

  return (
    <ReactFlowProvider>
      <div className="h-screen w-full flex flex-col bg-brand-bg select-none">
        {/* Header */}
        <header className="h-16 border-b border-brand-line bg-white/80 backdrop-blur-md px-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-ink flex items-center justify-center text-white font-mono text-xl font-bold">
              AV
            </div>
            <div>
              {architectures.length > 1 ? (
                <select
                  value={selectedArchId}
                  onChange={(e) => handleArchitectureChange(e.target.value)}
                  className="font-semibold text-sm leading-tight uppercase tracking-tight bg-transparent border-none focus:outline-none cursor-pointer hover:opacity-70 -ml-1 pr-2"
                  title="Sélectionner une architecture"
                >
                  {architectures.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <h1 className="font-semibold text-sm leading-tight uppercase tracking-tight">
                  {config.architecture || "New Architecture"}
                </h1>
              )}
              <p className="text-[10px] font-mono opacity-50 uppercase">
                v{config?.version || "0.0.0"} • {config?.lastUpdated || "N/A"} • {architectures.find(a => a.id === selectedArchId)?.fileName ?? ""}
              </p>
            </div>

            {neighbors.length > 0 && (
              <div className="flex items-center gap-1.5 pl-3 ml-1 border-l border-brand-line">
                <span className="text-[9px] font-mono uppercase opacity-40 flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Liées
                </span>
                {neighbors.map((n) => (
                  <button
                    key={n.archId}
                    onClick={() => handleArchitectureChange(n.archId)}
                    className="px-2 py-0.5 text-[10px] font-mono border border-purple-300 text-purple-700 hover:bg-purple-600 hover:text-white transition-colors"
                    title={`Ouvrir l'architecture « ${n.archName} »`}
                  >
                    {n.archName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
             <div className="flex items-center border border-brand-line">
                {([
                  ['graph', 'Graphe', <Network className="w-3.5 h-3.5" key="g" />],
                  ['endpoints', 'Endpoints', <List className="w-3.5 h-3.5" key="e" />],
                  ['data', 'Données', <Grid3x3 className="w-3.5 h-3.5" key="d" />],
                  ['network', 'Réseau', <Boxes className="w-3.5 h-3.5" key="n" />],
                ] as const).map(([id, label, icon]) => (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    className={cn(
                      'px-3 h-9 flex items-center gap-1.5 text-[10px] font-mono uppercase transition-colors border-r border-brand-line last:border-r-0',
                      view === id ? 'bg-brand-ink text-white' : 'bg-white text-brand-ink hover:bg-brand-bg',
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
             </div>
             <div className={cn(
               'flex items-center gap-2 border-r border-brand-line pr-4',
               view !== 'graph' && 'opacity-30 pointer-events-none',
             )}>
                <button
                  onClick={() => setShowFlowSummary(v => {
                    const next = !v;
                    try { localStorage.setItem('av:showFlowSummary', String(next)); } catch {}
                    return next;
                  })}
                  className={cn(
                    "px-3 h-8 text-[10px] font-mono border uppercase transition-all",
                    showFlowSummary ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-ink border-brand-line opacity-50"
                  )}
                >
                  Flow Summary
                </button>
                <button
                  onClick={() => setShowLayersLegend(v => {
                    const next = !v;
                    try { localStorage.setItem('av:showLayersLegend', String(next)); } catch {}
                    return next;
                  })}
                  className={cn(
                    "px-3 h-8 text-[10px] font-mono border uppercase transition-all",
                    showLayersLegend ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-ink border-brand-line opacity-50"
                  )}
                >
                  Layers
                </button>
                <button
                  onClick={() => setEndpointMode(prev => {
                    const next = prev === 'compact' ? 'detailed' : 'compact';
                    try { localStorage.setItem('av:endpointMode', next); } catch {}
                    return next;
                  })}
                  className={cn(
                    "px-3 h-8 text-[10px] font-mono border uppercase transition-all",
                    endpointMode === 'detailed' ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-ink border-brand-line opacity-50"
                  )}
                  title={endpointMode === 'compact' ? 'Afficher chaque endpoint comme nœud individuel' : 'Revenir au mode compact (badge de comptage)'}
                >
                  Endpoints ▦
                </button>
                <button
                  onClick={() => setShowHealthOverlay(v => !v)}
                  className={cn(
                    "px-3 h-8 text-[10px] font-mono border uppercase transition-all",
                    showHealthOverlay ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-ink border-brand-line opacity-50"
                  )}
                  title="Afficher badges de sévérité + complétude sur les nœuds"
                >
                  Santé ▦
                </button>
             </div>
             <div className={cn(
               'flex items-center gap-1 border-r border-brand-line pr-4 mr-2',
               view !== 'graph' && 'opacity-30 pointer-events-none',
             )}>
                <span className="text-[9px] font-mono opacity-40 uppercase mr-2">Filter Layers:</span>
                <div className="flex gap-1">
                  {(config.layers ?? []).map((layer) => (
                    <button
                      key={layer.name}
                      onClick={() => toggleLayer(layer.name)}
                      className={cn(
                        "px-2 py-1 text-[10px] font-mono border transition-all",
                        visibleLayers.has(layer.name) 
                          ? "border-brand-ink bg-brand-ink text-white" 
                          : "border-brand-line bg-white text-brand-ink opacity-50 hover:opacity-100"
                      )}
                    >
                      {layer.name}
                    </button>
                  ))}
                </div>
             </div>
             <button
              onClick={() => setIsHealthOpen(v => !v)}
              className={cn(
                "px-4 h-9 flex items-center gap-2 border transition-colors text-xs font-mono uppercase",
                isHealthOpen ? "bg-brand-ink text-white border-brand-ink" : "border-brand-line hover:bg-brand-ink hover:text-white"
              )}
              title="Panneau santé — intégrité, complétude, lineage"
            >
              <Activity className="w-4 h-4" />
              Santé
            </button>
             <button
              onClick={() => setIsFormEditorOpen(true)}
              className="px-4 h-9 flex items-center gap-2 border border-brand-line hover:bg-brand-ink hover:text-white transition-colors text-xs font-mono uppercase"
              title="Édition par formulaire — validation manifeste"
            >
              <SquarePen className="w-4 h-4" />
              Form Editor
            </button>
             <button
              onClick={() => setIsEditorOpen(!isEditorOpen)}
              className="px-4 h-9 flex items-center gap-2 border border-brand-line hover:bg-brand-ink hover:text-white transition-colors text-xs font-mono uppercase"
            >
              <FileJson className="w-4 h-4" />
              JSON
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden relative">
          {/* Sequence panel — companion to the data-flow visualization */}
          <AnimatePresence>
            {dataFlow && view === 'graph' && (
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                className="h-full"
              >
                <SequencePanel flow={dataFlow} labels={componentLabels} onClose={clearLineage} onFocusStep={setActiveFlowEdge} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Graph Area */}
          <main className="flex-1 h-full relative">
            {view === 'endpoints' && (
              <EndpointsView
                config={config}
                onLineageEndpoint={handleLineageEndpoint}
                onFocusComponent={handleFocusComponent}
              />
            )}
            {view === 'data' && (
              <CrudMatrix
                config={config}
                onLineageEndpoint={handleLineageEndpoint}
                onHighlightTable={handleLineageTable}
              />
            )}
            {view === 'network' && (
              <NetworkView
                registry={architectures}
                crossLinks={crossLinks}
                onOpenComponent={handleOpenFromNetwork}
              />
            )}
            {view === 'graph' && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              className="bg-brand-bg"
              selectionOnDrag
            >
              <Background color="#14141414" gap={20} size={1} />
              <Controls className="!shadow-none !border-brand-line" />
              <MiniMap 
                className="!bg-white !border-brand-line" 
                nodeStrokeColor="#141414"
                nodeColor={(n: any) => n.data.layerColor || '#eee'}
              />
              
              <Panel position="top-center" className="flex flex-col gap-2">
                <AnimatePresence>
                  {dataFlow && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="bg-purple-600 text-white px-3 py-2 text-xs flex items-center gap-3 shadow-lg"
                    >
                      <Crosshair className="w-4 h-4" />
                      <span className="font-mono">
                        Parcours des données · {({ endpoint: 'endpoint', resource: 'ressource', route: 'page', component: 'composant' } as const)[dataFlow.kind]} <b>{dataFlow.title}</b> — {dataFlow.connectionIds.size} lien(s)
                      </span>
                      <button
                        onClick={clearLineage}
                        className="flex items-center gap-1 text-[10px] uppercase font-mono border border-white/40 px-2 py-0.5 hover:bg-white hover:text-purple-700 transition-colors"
                      >
                        <X className="w-3 h-3" /> Effacer
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Panel>

              {neighbors.length > 0 && (
                <Panel position="top-left" className="bg-white/90 backdrop-blur-sm border border-brand-line p-3 max-w-[15rem]">
                  <h4 className="text-[10px] font-mono uppercase font-bold opacity-50 flex items-center gap-1.5 mb-2">
                    <Link2 className="w-3.5 h-3.5" /> Architectures liées
                  </h4>
                  <div className="space-y-1.5">
                    {neighbors.map((n) => {
                      const on = expandedArchs.has(n.archId);
                      return (
                        <button
                          key={n.archId}
                          onClick={() => toggleExpandArch(n.archId)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 border text-left transition-colors text-[11px]',
                            on
                              ? 'border-purple-400 bg-purple-600 text-white'
                              : 'border-brand-line bg-white hover:border-purple-300 hover:text-purple-700',
                          )}
                          title={on ? 'Masquer cette architecture' : 'Faire apparaître cette architecture'}
                        >
                          {on ? <Eye className="w-3.5 h-3.5 shrink-0" /> : <EyeOff className="w-3.5 h-3.5 shrink-0 opacity-50" />}
                          <span className="font-mono truncate flex-1">{n.archName}</span>
                        </button>
                      );
                    })}
                  </div>
                  {expandedArchs.size > 0 && (
                    <button
                      onClick={() => setExpandedArchs(new Set())}
                      className="mt-2 w-full text-[9px] font-mono uppercase opacity-50 hover:opacity-100 border border-brand-line py-1 transition-opacity"
                    >
                      Tout masquer
                    </button>
                  )}
                </Panel>
              )}

              <Panel position="top-right" className="flex flex-col gap-2">
                <AnimatePresence>
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="bg-red-50 border border-red-200 p-3 text-red-600 text-xs flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
              </Panel>

              <AnimatePresence>
                {showFlowSummary && (
                  <Panel position="bottom-left" className="bg-white/80 backdrop-blur-sm border border-brand-line p-4 max-w-sm">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                    >
                      <h4 className="text-[10px] font-mono uppercase opacity-50 mb-2">Flow Summary</h4>
                      <p className="text-xs leading-relaxed mb-3">
                        {config?.flow_summary?.user_flow || "No flow summary available."}
                      </p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="p-2 bg-brand-bg border border-brand-line">
                          <div className="text-[10px] opacity-50">Components</div>
                          <div className="text-lg font-mono">{config?.components?.length || 0}</div>
                        </div>
                        <div className="p-2 bg-brand-bg border border-brand-line">
                          <div className="text-[10px] opacity-50">External</div>
                          <div className="text-lg font-mono">{config?.flow_summary?.external_services || 0}</div>
                        </div>
                      </div>

                      {config?.warnings && config.warnings.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-[9px] font-mono font-bold uppercase text-red-600 flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            Active Warnings ({config?.warnings?.length})
                          </h4>
                          <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                            {config.warnings.map((w, i) => (
                              <div key={i} className="text-[10px] p-2 bg-red-50 border border-red-100 leading-tight">
                                {w.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  </Panel>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {showLayersLegend && (
                  <Panel position="bottom-right" className="bg-white/80 backdrop-blur-sm border border-brand-line p-4 max-w-xs space-y-4">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="space-y-4"
                    >
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-mono uppercase font-bold opacity-50 border-b border-brand-line pb-1">Architecture Layers</h4>
                        <div className="space-y-2">
                          {(config.layers ?? []).map((layer, i) => (
                            <div key={i} className="flex gap-2">
                              <div className="w-3 h-3 border border-brand-line shrink-0 mt-0.5" style={{ backgroundColor: layer.color }}></div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold leading-none">{layer.name}</span>
                                <span className="text-[9px] opacity-60 leading-tight">{layer.description}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-mono uppercase font-bold opacity-50 border-b border-brand-line pb-1">Connection State</h4>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 border-b-2 border-brand-ink"></div>
                              <span className="text-[9px] font-mono opacity-60">Synchronous Call</span>
                            </div>
                            <div className="flex items-center gap-2 opacity-50">
                              <div className="w-6 border-b-2 border-brand-ink border-dashed"></div>
                              <span className="text-[9px] font-mono">Asynchronous/Optional</span>
                            </div>
                        </div>
                      </div>
                    </motion.div>
                  </Panel>
                )}
              </AnimatePresence>
            </ReactFlow>
            )}
          </main>

          {/* Right Panels Container */}
          <div className="flex shrink-0">
             {/* Info Sidebar / Details */}
            <AnimatePresence mode="wait">
              {selectedElement && (
                <motion.aside
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  className="w-[30rem] bg-white border-l border-brand-line flex flex-col h-full z-20 shadow-[-20px_0_40px_rgba(0,0,0,0.02)]"
                >
                  <div className="h-16 flex items-center justify-between px-6 border-b border-brand-line">
                    <h2 className="text-xs font-mono uppercase font-bold flex items-center gap-2">
                      <Search className="w-4 h-4" />
                      Inspector
                    </h2>
                    <button 
                      onClick={() => setSelectedElement(null)}
                      className="p-1 hover:bg-brand-bg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {selectedElement.type === 'node' ? (
                      <NodeDetails
                        data={selectedElement.data}
                        link={currentLinks.get(selectedElement.data?.id)}
                        isExpanded={(() => { const l = currentLinks.get(selectedElement.data?.id); return l ? expandedArchs.has(l.toArchId) : false; })()}
                        onLineageEndpoint={handleLineageEndpoint}
                        onLineageTable={handleLineageTable}
                        onOpenArchitecture={handleArchitectureChange}
                        onToggleExpand={toggleExpandArch}
                        onRouteFlow={handleRouteFlow}
                      />
                    ) : (
                      <EdgeDetails data={selectedElement.data} />
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            {/* Health Panel */}
            <AnimatePresence mode="wait">
              {isHealthOpen && (
                <motion.aside
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                >
                  <HealthPanel
                    config={config}
                    onClose={() => setIsHealthOpen(false)}
                    onHighlightTable={handleLineageTable}
                    onFocusComponent={handleFocusComponent}
                    onGoToIssue={handleGoToIssue}
                  />
                </motion.aside>
              )}
            </AnimatePresence>

            {/* JSON Editor Overlay */}
             <AnimatePresence>
              {isEditorOpen && (
                <motion.aside
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  className="w-[36rem] bg-[#141414] text-white flex flex-col h-full z-30 shadow-2xl"
                >
                  <div className="h-16 flex items-center justify-between px-6 border-b border-white/10 gap-4">
                    <h2 className="text-xs font-mono uppercase font-bold flex items-center gap-2 shrink-0">
                      <Code2 className="w-4 h-4" />
                      JSON Configuration
                      {isDirty && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" title="Modifications non sauvegardées" />
                      )}
                    </h2>

                    <div className="flex items-center gap-2 ml-auto">
                      {/* Save status feedback */}
                      {saveStatus === 'saved' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-green-400">
                          <CheckCircle className="w-3 h-3" /> Enregistré
                        </span>
                      )}
                      {saveStatus === 'error' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-red-400">
                          <AlertCircle className="w-3 h-3" /> Erreur
                        </span>
                      )}

                      {/* Save button */}
                      <button
                        onClick={handleSave}
                        disabled={!isDirty || !!error || schemaErrorCount > 0 || saveStatus === 'saving'}
                        title={
                          schemaErrorCount > 0 ? `${schemaErrorCount} erreur(s) de schéma` :
                          !!error ? 'JSON invalide' :
                          !isDirty ? 'Aucune modification' :
                          'Sauvegarder (Ctrl+S)'
                        }
                        className={cn(
                          "flex items-center gap-1.5 px-3 h-7 text-[10px] font-mono uppercase border transition-all",
                          isDirty && !error && schemaErrorCount === 0 && saveStatus !== 'saving'
                            ? "border-amber-400 text-amber-400 hover:bg-amber-400 hover:text-black"
                            : "border-white/20 text-white/30 cursor-not-allowed"
                        )}
                      >
                        <Save className="w-3 h-3" />
                        {saveStatus === 'saving' ? 'Saving…' : 'Save'}
                      </button>

                      <button
                        onClick={() => setIsEditorOpen(false)}
                        className="p-1 hover:bg-white/10 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 min-h-0">
                      <JsonEditor
                        value={jsonData}
                        onChange={setJsonData}
                        onSave={handleSave}
                        onValidate={setSchemaErrorCount}
                        reveal={reveal}
                      />
                    </div>
                    {error && (
                      <div className="p-4 bg-red-600/20 text-red-400 text-[10px] font-mono border-t border-red-500/30 shrink-0">
                        {error}
                      </div>
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Form Editor — fullscreen overlay */}
        <AnimatePresence>
          {isFormEditorOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 top-16 bottom-8 z-40 bg-white"
            >
              <ArchitectureEditor
                arch={config}
                onChange={handleFormChange}
                onClose={() => setIsFormEditorOpen(false)}
                onSave={handleSave}
                onReset={handleResetUnsaved}
                isDirty={isDirty}
                saveStatus={saveStatus}
                fileName={architectures.find((a) => a.id === selectedArchId)?.fileName ?? ''}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer/StatusBar */}
        <footer className="h-8 border-t border-brand-line bg-white/50 backdrop-blur-sm px-6 flex items-center justify-between text-[10px] font-mono opacity-50">
          <div className="flex gap-4">
            <span>NODES: {nodes.length}</span>
            <span>EDGES: {edges.length}</span>
          </div>
          <div className="flex gap-4">
             {config?.warnings && config.warnings.length > 0 && (
               <span className="text-red-600 font-bold uppercase">{config.warnings.length} WARNINGS</span>
             )}
            <span>© 2026 ARCHITECTVIZ ENGINE</span>
          </div>
        </footer>
      </div>
    </ReactFlowProvider>
  );
}

function NodeDetails({
  data,
  link,
  isExpanded,
  onLineageEndpoint,
  onLineageTable,
  onOpenArchitecture,
  onToggleExpand,
  onRouteFlow,
}: {
  data: Component;
  link?: CrossLink;
  isExpanded: boolean;
  onLineageEndpoint: (componentId: string, method: string, path: string) => void;
  onLineageTable: (dbComponentId: string, tableName: string) => void;
  onOpenArchitecture: (archId: string) => void;
  onToggleExpand: (archId: string) => void;
  onRouteFlow: (frontendId: string, routePath: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase font-mono opacity-50 mb-1">{data.layer}</div>
        <h3 className="text-xl font-bold leading-tight">{data.label}</h3>
        <p className="text-xs mt-2 opacity-70 leading-relaxed">{data.description}</p>
      </div>

      {link && (
        <div className="border border-purple-300 bg-purple-50">
          <div className="flex items-center gap-2 p-3" title={`Confiance ${Math.round(link.confidence * 100)}% — ${link.reason}`}>
            <Link2 className="w-4 h-4 shrink-0 text-purple-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-mono uppercase opacity-60">Architecture liée · {Math.round(link.confidence * 100)}%</div>
              <div className="text-sm font-bold truncate">{link.toArchName}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-purple-200">
            <button
              onClick={() => onToggleExpand(link.toArchId)}
              className={cn(
                'flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono uppercase border-r border-purple-200 transition-colors',
                isExpanded ? 'bg-purple-600 text-white' : 'text-purple-700 hover:bg-purple-100',
              )}
            >
              {isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {isExpanded ? 'Masquer ici' : 'Afficher ici'}
            </button>
            <button
              onClick={() => onOpenArchitecture(link.toArchId)}
              className="flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono uppercase text-purple-700 hover:bg-purple-100 transition-colors"
            >
              Ouvrir <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {data.provenance && (
        <div className="-mt-3">
          <span
            className="inline-block text-[9px] font-mono uppercase px-1.5 py-0.5 border border-brand-line opacity-70"
            title={PROVENANCE_META[data.provenance as Provenance]?.label}
          >
            {PROVENANCE_META[data.provenance as Provenance]?.short ?? data.provenance}
            {typeof data.confidence === 'number' ? ` · ${Math.round(data.confidence * 100)}%` : ''}
          </span>
        </div>
      )}

      <div className="pt-4 border-t border-brand-line space-y-4 text-xs">
        <DetailRow label="ID" value={data.id} mono />
        <DetailRow label="Technology" value={data.technology} />
        {data.build_tool && <DetailRow label="Build Tool" value={data.build_tool} />}
        {data.state_management && <DetailRow label="State MGMT" value={data.state_management} />}
        {data.url && <DetailRow label="URL" value={data.url} mono />}
        {data.port && <DetailRow label="Port" value={data.port.toString()} mono />}
      </div>

      {(data.owner || data.team || data.criticality || data.environment) && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Organisation</h4>
          <div className="bg-brand-bg border border-brand-line p-3 space-y-2 text-[11px]">
            {data.team && <DetailRow label="Team" value={data.team} />}
            {data.owner && <DetailRow label="Owner" value={data.owner} />}
            {data.environment && <DetailRow label="Env" value={data.environment} />}
            {data.criticality && (
              <div className="flex justify-between items-center gap-4">
                <span className="text-[10px] uppercase font-mono opacity-50">Criticality</span>
                <span className={cn(
                  'text-[9px] font-mono font-bold px-1.5 py-0.5 uppercase',
                  data.criticality === 'critical' ? 'bg-red-100 text-red-700' :
                  data.criticality === 'high' ? 'bg-orange-100 text-orange-700' :
                  data.criticality === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600',
                )}>
                  {data.criticality}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {data.deployment && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Deployment</h4>
          <div className="bg-brand-bg border border-brand-line p-3 space-y-2 text-[11px]">
            <DetailRow label="Platform" value={data.deployment.platform} />
            <DetailRow label="Region" value={data.deployment.region} />
            <DetailRow label="CI/CD" value={data.deployment.ci_cd} />
            {data.deployment.orchestration && <DetailRow label="Orchestrator" value={data.deployment.orchestration} />}
            {data.deployment.scaling && <DetailRow label="Scaling" value={data.deployment.scaling} />}
          </div>
        </div>
      )}

      {data.routes && data.routes.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Routes</h4>
          <div className="bg-brand-bg border border-brand-line overflow-hidden">
            {data.routes.map((route, i) => (
              <div key={i} className="p-3 border-b border-brand-line last:border-0 hover:bg-white transition-colors">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="font-mono text-[11px] font-bold truncate">{route.path}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {route.authenticated && (
                       <span className="text-[8px] bg-brand-ink text-white px-1 py-0.5">AUTH</span>
                    )}
                    {(route.api_calls?.length ?? 0) > 0 && (
                      <button
                        onClick={() => onRouteFlow(data.id, route.path)}
                        className="flex items-center gap-0.5 text-[8px] uppercase font-mono border border-purple-300 text-purple-700 px-1 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
                        title="Visualiser le parcours des données de cette page"
                      >
                        <Crosshair className="w-2.5 h-2.5" /> parcours
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[10px] opacity-70 mb-2">{route.label}</div>
                {route.api_calls && (
                  <div className="space-y-1">
                    {route.api_calls.map((call, j) => (
                      <div key={j} className="text-[9px] font-mono bg-white/50 p-1 border border-brand-line/50 opacity-60">
                        {call}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.endpoints && data.endpoints.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Endpoints</h4>
          <div className="bg-brand-bg border border-brand-line overflow-hidden">
             {data.endpoints.map((ep, i) => (
               <div key={i} className="p-3 border-b border-brand-line last:border-0 hover:bg-white transition-colors">
                 <div className="flex items-center justify-between mb-1">
                   <div className="flex items-center gap-2">
                     <span className={cn(
                       "text-[9px] font-bold px-1 py-0.5",
                       ep.method === 'GET' ? 'bg-blue-100 text-blue-800' :
                       ep.method === 'POST' ? 'bg-green-100 text-green-800' :
                       'bg-orange-100 text-orange-800'
                     )}>
                       {ep.method}
                     </span>
                     <span className="font-mono text-[11px]">{ep.path}</span>
                   </div>
                   <div className="flex items-center gap-1.5">
                     {ep.authenticated === false && (
                       <span className="text-[8px] bg-red-100 text-red-700 px-1 font-bold">PUBLIC</span>
                     )}
                     {validationStatus(ep.validation) !== 'none' && (() => {
                       const vs = validationStatus(ep.validation);
                       return (
                         <span className={cn(
                           'text-[9px] font-bold',
                           vs === 'valid' ? 'text-green-700' : vs === 'invalid' ? 'text-red-600' : 'text-amber-600',
                         )}>
                           {VALIDATION_META[vs].emoji} {VALIDATION_META[vs].label}
                         </span>
                       );
                     })()}
                     {ep.provenance && (
                       <span className="text-[8px] font-mono px-1 border border-brand-line opacity-50" title={PROVENANCE_META[ep.provenance as Provenance]?.label}>
                         {PROVENANCE_META[ep.provenance as Provenance]?.short ?? ep.provenance}
                       </span>
                     )}
                     {(ep.data_access?.length ?? 0) > 0 && (
                       <button
                         onClick={() => onLineageEndpoint(data.id, ep.method, ep.path)}
                         className="flex items-center gap-0.5 text-[8px] uppercase font-mono border border-purple-300 text-purple-700 px-1 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
                         title="Surligner le lineage de cet endpoint"
                       >
                         <Crosshair className="w-2.5 h-2.5" /> lineage
                       </button>
                     )}
                   </div>
                 </div>
                 <div className="text-[10px] opacity-70 mb-1">{ep.description}</div>
                 {ep.mapped_from_frontend && (
                   <div className="text-[9px] font-mono opacity-40">→ {ep.mapped_from_frontend}</div>
                 )}
                 {(ep.data_access?.length ?? 0) > 0 && (
                   <div className="mt-2 space-y-1">
                     {ep.data_access!.map((da, j) => (
                       <div key={j} className="flex items-center gap-1.5 text-[9px] font-mono">
                         <span className={cn(
                           "px-1 py-0.5 font-bold",
                           /SELECT|GET/i.test(da.operation) ? 'bg-blue-50 text-blue-700' :
                           /INSERT|UPSERT|SET|POST|PUBLISH/i.test(da.operation) ? 'bg-green-50 text-green-700' :
                           /DELETE|DEL/i.test(da.operation) ? 'bg-red-50 text-red-700' :
                           'bg-gray-50 text-gray-700'
                         )}>
                           {da.operation}
                         </span>
                         <span className="opacity-50">{da.component_id}</span>
                         <span className="opacity-90">{da.resource}</span>
                       </div>
                     ))}
                   </div>
                 )}
                 {((ep.request_fields?.length ?? 0) > 0 || (ep.response_fields?.length ?? 0) > 0) && (
                   <div className="mt-2 grid grid-cols-2 gap-2">
                     {ep.request_fields && ep.request_fields.length > 0 && (
                       <ContractFields title="Request" fields={ep.request_fields} />
                     )}
                     {ep.response_fields && ep.response_fields.length > 0 && (
                       <ContractFields title="Response" fields={ep.response_fields} />
                     )}
                   </div>
                 )}
               </div>
             ))}
          </div>
        </div>
      )}

      {data.cached_data && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Cached Data</h4>
          <div className="bg-brand-bg border border-brand-line overflow-hidden">
            {data.cached_data.map((item, i) => (
              <div key={i} className="p-3 border-b border-brand-line last:border-0">
                <div className="font-mono text-[11px] font-bold mb-1">{item.key_pattern}</div>
                <div className="flex items-center justify-between text-[10px] opacity-70">
                  <span>TTL: {item.ttl}</span>
                  <span className="italic">{item.purpose}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.tables && data.tables.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Tables</h4>
          <div className="bg-brand-bg border border-brand-line overflow-hidden">
            {data.tables.map((t, i) => (
              <div key={i} className="p-3 border-b border-brand-line last:border-0 hover:bg-white transition-colors flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-bold flex items-center gap-1.5">
                    <Database className="w-3 h-3 opacity-50" />
                    {t.name}
                  </div>
                  {t.purpose && <div className="text-[10px] opacity-60 leading-tight">{t.purpose}</div>}
                </div>
                <button
                  onClick={() => onLineageTable(data.id, t.name)}
                  className="shrink-0 flex items-center gap-0.5 text-[8px] uppercase font-mono border border-purple-300 text-purple-700 px-1 py-0.5 hover:bg-purple-600 hover:text-white transition-colors"
                  title="Surligner les endpoints qui touchent cette table"
                >
                  <Crosshair className="w-2.5 h-2.5" /> qui touche
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.key_dependencies && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Dependencies</h4>
          <div className="flex flex-wrap gap-2">
            {data.key_dependencies.map((dep, i) => (
              <span key={i} className="px-2 py-1 bg-brand-bg border border-brand-line text-[9px] font-mono">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeDetails({ data }: { data: ArchConnection }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase font-mono opacity-50 mb-1">Connection</div>
        <h3 className="text-xl font-bold flex items-center gap-3">
          {data.from} <ArrowRight className="w-5 h-5" /> {data.to}
        </h3>
        <p className="text-xs mt-2 opacity-70 leading-relaxed">{data.description}</p>
      </div>

      <div className="pt-4 border-t border-brand-line space-y-4 text-xs">
        <DetailRow label="Protocol" value={data.protocol} mono />
        <DetailRow label="Auth" value={data.authenticated ? "Required" : "Public"} />
        {data.client && <DetailRow label="Client" value={data.client} />}
        {data.latency && <DetailRow label="Latency" value={data.latency} mono />}
        {data.cache_strategy && <DetailRow label="Strategy" value={data.cache_strategy} />}
      </div>

      {data.flow && (
        <div className="p-3 bg-brand-bg border border-brand-line text-[11px] font-mono italic opacity-70">
          Flow: {data.flow}
        </div>
      )}

      {data.endpoint_mappings && (
         <div className="space-y-3">
            <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Detailed Mappings</h4>
            <div className="bg-brand-bg border border-brand-line overflow-hidden">
               {data.endpoint_mappings.map((mapping, i) => (
                 <div key={i} className="p-3 border-b border-brand-line last:border-0 hover:bg-white transition-colors">
                    <div className="text-[9px] font-mono opacity-50 mb-1">
                      {mapping.frontend_endpoint}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                       <span className="text-[9px] font-bold bg-brand-ink text-white px-1 py-0.5">{mapping.method}</span>
                       <span className="font-mono text-[11px] font-bold">{mapping.backend_endpoint}</span>
                    </div>
                    <div className="text-[10px] opacity-70 mb-2">{mapping.purpose}</div>
                    {mapping.frontend_pages && (
                      <div className="flex flex-wrap gap-1">
                         {mapping.frontend_pages.map((p, j) => (
                           <span key={j} className="text-[8px] bg-white border border-brand-line px-1 opacity-70">{p}</span>
                         ))}
                      </div>
                    )}
                 </div>
               ))}
            </div>
         </div>
      )}

      {data.endpoints && (
         <div className="space-y-3">
            <h4 className="text-[10px] font-mono uppercase font-bold opacity-50">Interface Mappings</h4>
            <div className="bg-brand-bg border border-brand-line overflow-hidden">
               {data.endpoints.map((ep: string | { method?: string; backend_endpoint?: string; frontend_call?: string; pages?: string[] }, i: number) => {
                 const isString = typeof ep === 'string';
                 const parts = isString ? ep.split(' ') : null;
                 const method = isString ? parts![0] : ep.method;
                 const path = isString ? parts!.slice(1).join(' ') : ep.backend_endpoint;
                 const frontendCall = isString ? undefined : ep.frontend_call;
                 const pages = isString ? undefined : ep.pages;
                 return (
                   <div key={i} className="p-3 border-b border-brand-line last:border-0 hover:bg-white transition-colors">
                      {frontendCall && (
                        <div className="text-[9px] font-mono opacity-50 mb-1">{frontendCall}</div>
                      )}
                      <div className="flex items-center gap-2 mb-1">
                         <span className="text-[9px] font-bold bg-brand-ink text-white px-1 py-0.5">{method}</span>
                         <span className="font-mono text-[11px] font-bold">{path}</span>
                      </div>
                      {pages && (
                        <div className="flex gap-1 mt-2">
                           {pages.map((p: string, j: number) => (
                             <span key={j} className="text-[8px] bg-white border border-brand-line px-1 opacity-70">{p}</span>
                           ))}
                        </div>
                      )}
                   </div>
                 );
               })}
            </div>
         </div>
      )}
    </div>
  );
}

function ContractFields({ title, fields }: { title: string; fields: { name: string; type?: string; description?: string; required?: boolean }[] }) {
  return (
    <div>
      <div className="text-[8px] font-mono uppercase opacity-40 mb-0.5">{title}</div>
      <div className="bg-white/60 border border-brand-line/50">
        {fields.map((f, i) => (
          <div key={i} className="px-1.5 py-0.5 border-b border-brand-line/40 last:border-0 text-[9px] font-mono leading-tight" title={f.description}>
            <span className="font-bold">{f.name}{f.required ? '' : '?'}</span>
            {f.type && <span className="opacity-50"> {f.type}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-[10px] uppercase font-mono opacity-50 shrink-0 mt-0.5">{label}</span>
      <span className={cn("text-right break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}
