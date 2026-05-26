// Pure inspection orchestrator — takes an in-memory ArchitectureConfig, returns a report.
// No fs, no React. Consumed by both the React Health panel and (optionally) the MCP server.

import type { ArchitectureConfig } from '../../types';
import { checkIntegrity } from './integrity';
import { computeCompleteness } from './completeness';
import { computeLineage, runQuery } from './lineage';
import type { InspectionReport } from './report-types';

export function inspectArchitecture(arch: ArchitectureConfig, options: { query?: string } = {}): InspectionReport {
  if (options.query) {
    return {
      integrity: { issues: [], summary: { critical: 0, warnings: 0, info: 0 } },
      completeness: computeCompleteness(arch),
      lineage: computeLineage(arch),
      query_result: runQuery(arch, options.query),
    };
  }

  const issues = checkIntegrity(arch);
  return {
    integrity: {
      issues,
      summary: {
        critical: issues.filter((i) => i.severity === 'CRITICAL').length,
        warnings: issues.filter((i) => i.severity === 'WARNING').length,
        info: issues.filter((i) => i.severity === 'INFO').length,
      },
    },
    completeness: computeCompleteness(arch),
    lineage: computeLineage(arch),
  };
}

export * from './report-types';
export { componentHealth } from './componentHealth';
export type { ComponentHealth } from './componentHealth';
export { checkIntegrity } from './integrity';
export { computeCompleteness } from './completeness';
export { computeLineage, runQuery, highlightForEndpoint, highlightForTable } from './lineage';
export type { LineageHighlight } from './lineage';
