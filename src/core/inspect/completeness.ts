// v2 — Complétude : score de qualité de la cartographie. Pur.

import type { ArchitectureConfig } from '../../types';
import type { CompletenessReport } from './report-types';

const MISSING = 'À confirmer';
const VERSION_REGEX = /\d+\.\d+(\.\d+)?/;

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '' || value === MISSING;
  return false;
}

function pct(n: number, d: number): number {
  if (d === 0) return 100;
  return Math.round((n / d) * 1000) / 10;
}

function collectPlaceholderPaths(arch: ArchitectureConfig, max = 10): string[] {
  const out: string[] = [];
  const push = (path: string) => { if (out.length < max) out.push(path); };

  if (arch.description === MISSING) push('$.description');
  if (arch.type === MISSING) push('$.type');

  (arch.components ?? []).forEach((c, ci) => {
    if (isMissing(c.description)) push(`$.components[${ci}].description (${c.id})`);
    if (isMissing(c.technology)) push(`$.components[${ci}].technology (${c.id})`);
    if (isMissing(c.url)) push(`$.components[${ci}].url (${c.id})`);
    if (c.authentication) {
      for (const [k, v] of Object.entries(c.authentication)) {
        if (isMissing(v)) push(`$.components[${ci}].authentication.${k} (${c.id})`);
      }
    }
    (c.endpoints ?? []).forEach((e, ei) => {
      if (isMissing(e.description)) push(`$.components[${ci}].endpoints[${ei}].description (${c.id} ${e.method} ${e.path})`);
    });
    (c.tables ?? []).forEach((t, ti) => {
      if (isMissing(t.purpose)) push(`$.components[${ci}].tables[${ti}].purpose (${c.id} ${t.name})`);
    });
    (c.cached_data ?? []).forEach((cd, di) => {
      if (isMissing(cd.purpose)) push(`$.components[${ci}].cached_data[${di}].purpose (${c.id} ${cd.key_pattern})`);
    });
  });

  (arch.connections ?? []).forEach((conn, ci) => {
    if (isMissing(conn.description)) push(`$.connections[${ci}].description (${conn.id ?? `${conn.from}→${conn.to}`})`);
  });

  return out;
}

function countAllPlaceholders(arch: ArchitectureConfig): number {
  let count = 0;
  const visit = (v: unknown): void => {
    if (v === MISSING) { count++; return; }
    if (Array.isArray(v)) { for (const i of v) visit(i); return; }
    if (v && typeof v === 'object') { for (const val of Object.values(v as Record<string, unknown>)) visit(val); }
  };
  visit(arch);
  return count;
}

export function computeCompleteness(arch: ArchitectureConfig): CompletenessReport {
  let endpointsTotal = 0;
  let endpointsWithDataAccess = 0;
  for (const c of arch.components ?? []) {
    for (const e of c.endpoints ?? []) {
      endpointsTotal++;
      if ((e.data_access ?? []).length > 0) endpointsWithDataAccess++;
    }
  }

  let routesTotal = 0;
  let routesWithApiCalls = 0;
  for (const c of arch.components ?? []) {
    if (c.type !== 'frontend') continue;
    for (const r of c.routes ?? []) {
      routesTotal++;
      if ((r.api_calls ?? []).length > 0) routesWithApiCalls++;
    }
  }

  const components = arch.components ?? [];
  const componentsWithDescription = components.filter((c) => !isMissing(c.description)).length;
  const componentsWithPreciseVersions = components.filter((c) => !isMissing(c.technology) && VERSION_REGEX.test(c.technology!)).length;

  let tablesTotal = 0;
  let tablesWithPurpose = 0;
  for (const c of components) {
    for (const t of c.tables ?? []) {
      tablesTotal++;
      if (!isMissing(t.purpose)) tablesWithPurpose++;
    }
  }

  const placeholderCount = countAllPlaceholders(arch);
  const samplePlaceholderPaths = collectPlaceholderPaths(arch);

  const endpointsScore = (pct(endpointsWithDataAccess, endpointsTotal) * 25) / 100;
  const routesScore = (pct(routesWithApiCalls, routesTotal) * 20) / 100;
  const componentsScore = (pct(componentsWithDescription, components.length) * 15) / 100;
  const versionsScore = (pct(componentsWithPreciseVersions, components.length) * 10) / 100;
  const tablesScore = (pct(tablesWithPurpose, tablesTotal) * 10) / 100;
  const baseline = components.length > 0 ? 30 : 0;
  const placeholderRatio = components.length > 0 ? Math.min(placeholderCount / components.length / 5, 1) : 1;
  const penalty = -20 * placeholderRatio;

  const overall = Math.max(0, Math.min(100, baseline + endpointsScore + routesScore + componentsScore + versionsScore + tablesScore + penalty));

  return {
    overall_score: Math.round(overall * 10) / 10,
    breakdown: {
      endpoints_total: endpointsTotal,
      endpoints_with_data_access: endpointsWithDataAccess,
      endpoints_with_data_access_pct: pct(endpointsWithDataAccess, endpointsTotal),
      routes_total: routesTotal,
      routes_with_api_calls: routesWithApiCalls,
      routes_with_api_calls_pct: pct(routesWithApiCalls, routesTotal),
      components_total: components.length,
      components_with_description: componentsWithDescription,
      components_with_description_pct: pct(componentsWithDescription, components.length),
      components_with_precise_versions: componentsWithPreciseVersions,
      components_with_precise_versions_pct: pct(componentsWithPreciseVersions, components.length),
      tables_total: tablesTotal,
      tables_with_purpose: tablesWithPurpose,
      tables_with_purpose_pct: pct(tablesWithPurpose, tablesTotal),
      placeholder_count: placeholderCount,
      sample_placeholder_paths: samplePlaceholderPaths,
    },
  };
}
