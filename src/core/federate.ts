// Targeted expansion: graft selected linked architectures onto the *current* one.
// Unlike the global network view, only explicitly expanded neighbours are merged in,
// attached at their cross-link point. Pure — no React.

import type { ArchitectureConfig, Component, Connection, Layer } from '../types';
import type { CrossLink } from './crossLinks';

export interface ArchRegistryEntry {
  id: string;
  name: string;
  data: ArchitectureConfig;
}

const ns = (archId: string, id: string) => `${archId}::${id}`;

/** Component that best represents an architecture as a cross-link endpoint. */
export function representativeComponent(arch: ArchitectureConfig): string | undefined {
  const comps = arch.components ?? [];
  return (
    comps.find((c) => c.type === 'backend')?.id ??
    comps.find((c) => c.type === 'frontend')?.id ??
    comps[0]?.id
  );
}

export interface ExpandedGraph {
  components: Component[];
  connections: Connection[];
  layers: Layer[];
  /** namespaced node id -> source architecture name (only for grafted foreign nodes) */
  archNameById: Map<string, string>;
  /** synthetic connection ids that are inter-architecture links */
  crossConnIds: Set<string>;
}

/**
 * Returns the current architecture's graph, with every architecture in `expanded`
 * grafted in (components/connections namespaced) and a cross-arch edge drawn from
 * each link's source component to the target architecture's representative node.
 */
export function expandArchitecture(
  current: ArchitectureConfig,
  currentArchId: string,
  registry: ArchRegistryEntry[],
  crossLinks: CrossLink[],
  expanded: Set<string>,
): ExpandedGraph {
  const components: Component[] = [...(current.components ?? [])];
  const connections: Connection[] = [...(current.connections ?? [])];
  const layers: Layer[] = [...(current.layers ?? [])];
  const layerNames = new Set(layers.map((l) => l.name));
  const archNameById = new Map<string, string>();
  const crossConnIds = new Set<string>();

  for (const archId of expanded) {
    if (archId === currentArchId) continue;
    const F = registry.find((a) => a.id === archId);
    if (!F) continue;

    for (const comp of F.data.components ?? []) {
      const nid = ns(archId, comp.id);
      components.push({ ...comp, id: nid });
      archNameById.set(nid, F.name);
    }
    for (const conn of F.data.connections ?? []) {
      connections.push({
        ...conn,
        id: ns(archId, conn.id),
        from: ns(archId, conn.from),
        to: ns(archId, conn.to),
      });
    }
    for (const l of F.data.layers ?? []) {
      if (!layerNames.has(l.name)) {
        layers.push(l);
        layerNames.add(l.name);
      }
    }
  }

  // Cross-arch edges between the current architecture and each expanded neighbour.
  const repCache = new Map<string, string | undefined>();
  const repOf = (id: string, data: ArchitectureConfig) => {
    if (!repCache.has(id)) repCache.set(id, representativeComponent(data));
    return repCache.get(id);
  };

  for (const l of crossLinks) {
    const involvesCurrent = l.fromArchId === currentArchId || l.toArchId === currentArchId;
    if (!involvesCurrent) continue;
    const otherArch = l.fromArchId === currentArchId ? l.toArchId : l.fromArchId;
    if (!expanded.has(otherArch)) continue;

    const F = registry.find((a) => a.id === otherArch);
    const sourceId =
      l.fromArchId === currentArchId ? l.fromComponentId : ns(l.fromArchId, l.fromComponentId);
    const targetId =
      l.toArchId === currentArchId
        ? repOf(currentArchId, current)
        : F
          ? ns(l.toArchId, repOf(otherArch, F.data) ?? '')
          : undefined;
    if (!sourceId || !targetId || targetId.endsWith('::')) continue;

    const id = `xlink_${l.fromArchId}_${l.fromComponentId}_${l.toArchId}`;
    if (crossConnIds.has(id)) continue;
    crossConnIds.add(id);
    connections.push({
      id,
      from: sourceId,
      to: targetId,
      protocol: `↗ ${l.toArchName}`,
      authenticated: false,
      description: `Lien inter-architecture (${Math.round(l.confidence * 100)}%) — ${l.reason}`,
    });
  }

  return { components, connections, layers, archNameById, crossConnIds };
}
