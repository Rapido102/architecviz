// Recompute flow_summary deterministically from the current state.

interface Architecture {
  layers?: { name: string }[];
  components?: Component[];
  flow_summary?: FlowSummary;
  [key: string]: unknown;
}

interface Component {
  id: string;
  type?: string;
  layer?: string;
  technology?: string;
  key_dependencies?: string[];
  endpoints?: unknown[];
  routes?: unknown[];
  [key: string]: unknown;
}

interface FlowSummary {
  user_flow?: string;
  technologies_count?: number;
  backend_endpoints?: number;
  frontend_routes?: number;
  external_services?: number;
}

export interface RecomputeResult {
  previous: FlowSummary | null;
  current: FlowSummary;
  changed_fields: string[];
}

/** Extract distinct library names (case-insensitive, ignoring version) from a tech string or array. */
function extractLibNames(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const text = Array.isArray(input) ? input.join(' + ') : input;
  // Splitter sur " + " puis prendre le mot avant le 1er chiffre/version
  const out: string[] = [];
  for (const part of text.split(/\s*\+\s*/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // "React 19.2.4" → "React" ; "@tanstack/react-query 5.90.12" → "@tanstack/react-query"
    const m = trimmed.match(/^(@?[\w./-]+)/);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

export function recomputeSummary(arch: Architecture): RecomputeResult {
  const previous = arch.flow_summary ? { ...arch.flow_summary } : null;

  const components = arch.components ?? [];

  // technologies_count
  const libSet = new Set<string>();
  for (const c of components) {
    for (const lib of extractLibNames(c.technology)) libSet.add(lib);
    for (const lib of extractLibNames(c.key_dependencies)) libSet.add(lib);
  }

  // backend_endpoints
  let backendEndpoints = 0;
  for (const c of components) {
    if (c.type === 'backend') backendEndpoints += (c.endpoints ?? []).length;
  }

  // frontend_routes
  let frontendRoutes = 0;
  for (const c of components) {
    if (c.type === 'frontend') frontendRoutes += (c.routes ?? []).length;
  }

  // external_services : composants où layer === "External"
  const externalServices = components.filter((c) => c.layer === 'External').length;

  const current: FlowSummary = {
    user_flow: previous?.user_flow,
    technologies_count: libSet.size,
    backend_endpoints: backendEndpoints,
    frontend_routes: frontendRoutes,
    external_services: externalServices,
  };

  arch.flow_summary = current;

  const changedFields: string[] = [];
  if (!previous) {
    changedFields.push('(created)');
  } else {
    for (const key of ['technologies_count', 'backend_endpoints', 'frontend_routes', 'external_services'] as const) {
      if (previous[key] !== current[key]) changedFields.push(key);
    }
  }

  return { previous, current, changed_fields: changedFields };
}
