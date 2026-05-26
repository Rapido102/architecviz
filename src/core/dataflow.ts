// Data-flow computation: for a selected endpoint (request-centric) or a data
// resource (data-centric), produce the path of existing connections it traverses,
// each annotated with WHAT data transits (resource + operation + payload) and an
// order for animation. Pure — built from data_access + endpoint_mappings.

import type { ArchitectureConfig, Component, Endpoint } from '../types';

export type FlowLabelKind = 'http' | 'payload' | 'db' | 'cache' | 'mq' | 'queue' | 'service';

export interface FlowLabel {
  text: string;
  operation?: string;
  kind: FlowLabelKind;
}

export interface FlowEdge {
  connectionId: string;
  from: string;
  to: string;
  order: number;
  labels: FlowLabel[];
  /** Response payload travelling back (caller edges only) — drives the reverse particle. */
  responseLabel?: string;
}

export interface DataFlow {
  kind: 'endpoint' | 'resource' | 'route' | 'component';
  title: string;
  componentIds: Set<string>;
  connectionIds: Set<string>;
  edges: FlowEdge[];
  byConnId: Map<string, FlowEdge>;
}

function normResource(r: string): string {
  return r.split('.').pop()?.replace(/[`"']/g, '') ?? r;
}

function kindForTarget(comp: Component | undefined): FlowLabelKind {
  switch (comp?.type) {
    case 'db': return 'db';
    case 'cache': return 'cache';
    case 'mq': return 'mq';
    case 'queue': return 'queue';
    default: return 'service';
  }
}

function payloadSummary(fields: { name: string }[] | undefined, schema: string | undefined): string | undefined {
  if (schema && schema.trim()) return schema;
  if (fields && fields.length) return `{ ${fields.slice(0, 3).map((f) => f.name).join(', ')}${fields.length > 3 ? '…' : ''} }`;
  return undefined;
}

function finalize(kind: DataFlow['kind'], title: string, edges: FlowEdge[], componentIds: Set<string>): DataFlow {
  const byConnId = new Map<string, FlowEdge>();
  for (const e of edges) {
    const existing = byConnId.get(e.connectionId);
    if (existing) {
      existing.labels.push(...e.labels);
      if (!existing.responseLabel && e.responseLabel) existing.responseLabel = e.responseLabel;
    } else {
      byConnId.set(e.connectionId, { ...e, labels: [...e.labels] });
    }
  }
  // Dedupe identical labels (same operation + text) on each edge.
  for (const e of byConnId.values()) {
    const seen = new Set<string>();
    e.labels = e.labels.filter((l) => {
      const k = `${l.operation ?? ''}|${l.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return {
    kind,
    title,
    componentIds,
    connectionIds: new Set(byConnId.keys()),
    edges: [...byConnId.values()].sort((a, b) => a.order - b.order),
    byConnId,
  };
}

/** Request-centric flow: everything a given endpoint's request touches. */
export function dataFlowForEndpoint(arch: ArchitectureConfig, componentId: string, method: string, path: string): DataFlow {
  const componentIds = new Set<string>([componentId]);
  const edges: FlowEdge[] = [];
  const comps = arch.components ?? [];
  const byId = new Map(comps.map((c) => [c.id, c]));

  const api = byId.get(componentId);
  const ep: Endpoint | undefined = api?.endpoints?.find(
    (e) => e.method.toUpperCase() === method.toUpperCase() && e.path === path,
  );

  // 1) Caller edges (frontend → api) via endpoint_mappings.
  for (const conn of arch.connections ?? []) {
    if (conn.to !== componentId || !conn.id) continue;
    const calls = (conn.endpoint_mappings ?? []).some(
      (m) => m.method.toUpperCase() === method.toUpperCase() && m.backend_endpoint === path,
    );
    if (!calls) continue;
    componentIds.add(conn.from);
    const reqPayload = payloadSummary(ep?.request_fields, ep?.params?.body?.[0]);
    const respPayload = payloadSummary(ep?.response_fields, ep?.response_schema);
    const labels: FlowLabel[] = [{ text: `${method} ${path}`, kind: 'http' }];
    if (reqPayload) labels.push({ text: `↓ ${reqPayload}`, kind: 'payload' });
    edges.push({ connectionId: conn.id, from: conn.from, to: componentId, order: 0, labels, responseLabel: respPayload });
  }

  // 2) data_access edges (api → db/cache/mq/queue/tiers) in declared order.
  (ep?.data_access ?? []).forEach((da, i) => {
    componentIds.add(da.component_id);
    const conn = (arch.connections ?? []).find((c) => c.from === componentId && c.to === da.component_id && c.id);
    if (!conn?.id) return;
    edges.push({
      connectionId: conn.id,
      from: componentId,
      to: da.component_id,
      order: i + 1,
      labels: [{ text: da.resource, operation: da.operation, kind: kindForTarget(byId.get(da.component_id)) }],
    });
  });

  return finalize('endpoint', `${method} ${path}`, edges, componentIds);
}

/** Data-centric flow: every endpoint + page that reads/writes a given resource. */
export function dataFlowForResource(arch: ArchitectureConfig, targetComponentId: string, resource: string): DataFlow {
  const componentIds = new Set<string>([targetComponentId]);
  const edges: FlowEdge[] = [];
  const comps = arch.components ?? [];
  const byId = new Map(comps.map((c) => [c.id, c]));
  const targetKind = kindForTarget(byId.get(targetComponentId));
  let order = 0;

  for (const c of comps) {
    for (const e of c.endpoints ?? []) {
      const hits = (e.data_access ?? []).filter(
        (da) => da.component_id === targetComponentId && normResource(da.resource) === resource,
      );
      if (hits.length === 0) continue;
      componentIds.add(c.id);

      // api → resource edge, labelled with the operation(s).
      const accessConn = (arch.connections ?? []).find((cn) => cn.from === c.id && cn.to === targetComponentId && cn.id);
      if (accessConn?.id) {
        edges.push({
          connectionId: accessConn.id,
          from: c.id,
          to: targetComponentId,
          order: ++order,
          labels: hits.map((da) => ({ text: resource, operation: da.operation, kind: targetKind })),
        });
      }

      // caller → api edge(s) that trigger this endpoint.
      for (const conn of arch.connections ?? []) {
        if (conn.to !== c.id || !conn.id) continue;
        const calls = (conn.endpoint_mappings ?? []).some(
          (m) => m.method.toUpperCase() === e.method.toUpperCase() && m.backend_endpoint === e.path,
        );
        if (!calls) continue;
        componentIds.add(conn.from);
        edges.push({
          connectionId: conn.id,
          from: conn.from,
          to: c.id,
          order: ++order,
          labels: [{ text: `${e.method} ${e.path}`, kind: 'http' }],
        });
      }
    }
  }

  return finalize('resource', resource, edges, componentIds);
}

const API_CALL_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)$/i;

/** Page-centric flow: everything a frontend route touches (aggregates its api_calls). */
export function dataFlowForRoute(arch: ArchitectureConfig, frontendId: string, routePath: string): DataFlow {
  const comps = arch.components ?? [];
  const fe = comps.find((c) => c.id === frontendId);
  const route = fe?.routes?.find((r) => r.path === routePath);
  const componentIds = new Set<string>([frontendId]);
  const edges: FlowEdge[] = [];
  let base = 0;

  for (const call of route?.api_calls ?? []) {
    const m = call.match(API_CALL_RE);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const path = m[2];
    const apiComp = comps.find((c) => c.type === 'backend' && (c.endpoints ?? []).some((e) => e.method.toUpperCase() === method && e.path === path));
    if (!apiComp) continue;
    const sub = dataFlowForEndpoint(arch, apiComp.id, method, path);
    for (const id of sub.componentIds) componentIds.add(id);
    for (const e of sub.edges) edges.push({ ...e, order: base + e.order });
    base += sub.edges.length + 2;
  }

  return finalize('route', routePath, edges, componentIds);
}

/** Component-centric flow: everything that transits through a node. */
export function dataFlowForComponent(arch: ArchitectureConfig, componentId: string): DataFlow {
  const comps = arch.components ?? [];
  const comp = comps.find((c) => c.id === componentId);
  const componentIds = new Set<string>([componentId]);
  const edges: FlowEdge[] = [];
  let base = 0;
  const push = (sub: DataFlow) => {
    for (const id of sub.componentIds) componentIds.add(id);
    for (const e of sub.edges) edges.push({ ...e, order: base + e.order });
    base += sub.edges.length + 2;
  };

  if (comp?.type === 'backend') {
    for (const e of comp.endpoints ?? []) push(dataFlowForEndpoint(arch, componentId, e.method, e.path));
  } else if (comp?.type === 'frontend') {
    for (const r of comp.routes ?? []) push(dataFlowForRoute(arch, componentId, r.path));
  } else if (comp && ['db', 'cache', 'mq', 'queue'].includes(comp.type as string)) {
    // Every distinct resource of this data component that is touched anywhere.
    const resources = new Set<string>();
    for (const c of comps) {
      for (const e of c.endpoints ?? []) {
        for (const da of e.data_access ?? []) {
          if (da.component_id === componentId) resources.add(normResource(da.resource));
        }
      }
    }
    for (const r of resources) push(dataFlowForResource(arch, componentId, r));
  } else {
    // Generic: connections touching this component.
    for (const conn of arch.connections ?? []) {
      if ((conn.from === componentId || conn.to === componentId) && conn.id) {
        componentIds.add(conn.from);
        componentIds.add(conn.to);
        edges.push({ connectionId: conn.id, from: conn.from, to: conn.to, order: ++base, labels: [{ text: conn.protocol, kind: 'http' }] });
      }
    }
  }

  return finalize('component', comp?.label ?? componentId, edges, componentIds);
}
