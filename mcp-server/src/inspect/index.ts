// MCP inspect wrapper : adds fs/staging loading around the pure core inspector.
// The inspection logic itself lives in the shared core (src/core/inspect, synced from <repo>/src/core).

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECTURES_DIR } from '../paths.js';
import { loadArchitectureState } from '../architecture-state.js';
import { inspectArchitecture as coreInspect } from '../core/inspect/index.js';
import type { ArchitectureConfig } from '../types.js';
import type { InspectionReport as CoreReport } from '../core/inspect/report-types.js';

export interface InspectionReport extends CoreReport {
  arch_name: string;
  file: string;
  exists: boolean;
}

const EMPTY: CoreReport = {
  integrity: { issues: [], summary: { critical: 0, warnings: 0, info: 0 } },
  completeness: {
    overall_score: 0,
    breakdown: {
      endpoints_total: 0, endpoints_with_data_access: 0, endpoints_with_data_access_pct: 0,
      routes_total: 0, routes_with_api_calls: 0, routes_with_api_calls_pct: 0,
      components_total: 0, components_with_description: 0, components_with_description_pct: 0,
      components_with_precise_versions: 0, components_with_precise_versions_pct: 0,
      tables_total: 0, tables_with_purpose: 0, tables_with_purpose_pct: 0,
      placeholder_count: 0, sample_placeholder_paths: [],
    },
  },
  lineage: { dead_tables: [], hot_tables: [], chatty_endpoints: [], unauthenticated_endpoints_mutating: [] },
};

export function inspectArchitecture(archName: string, options: { query?: string } = {}): InspectionReport {
  const targetFile = resolve(ARCHITECTURES_DIR, `${archName}.json`);

  let arch: ArchitectureConfig | null = null;
  let exists = false;

  if (existsSync(targetFile)) {
    try {
      arch = JSON.parse(readFileSync(targetFile, 'utf8')) as ArchitectureConfig;
      exists = true;
    } catch {
      arch = null;
    }
  }

  if (!arch) {
    const state = loadArchitectureState(archName);
    if (state.components.length > 0) {
      arch = { components: state.components } as unknown as ArchitectureConfig;
    }
  }

  if (!arch) {
    return { arch_name: archName, file: targetFile, exists: false, ...EMPTY };
  }

  const report = coreInspect(arch, options);
  return { arch_name: archName, file: targetFile, exists, ...report };
}
