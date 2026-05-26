// Per-component health: worst integrity severity + a lightweight completeness %.
// Reuses checkIntegrity so the on-graph overlay matches the Health panel exactly.

import type { ArchitectureConfig } from '../../types';
import type { Severity } from './report-types';
import { checkIntegrity } from './integrity';
import { validationStatus } from '../status';

const MISSING = 'À confirmer';
const VERSION_REGEX = /\d+\.\d+(\.\d+)?/;

function isMissing(v?: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '' || v === MISSING;
  return false;
}

export interface ComponentHealth {
  severity: Severity | null;
  issues: number;
  completeness: number; // 0..100
  unverified: number; // endpoints flagged "to verify"
}

const SEV_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };

export function componentHealth(arch: ArchitectureConfig): Map<string, ComponentHealth> {
  const out = new Map<string, ComponentHealth>();
  for (const c of arch.components ?? []) out.set(c.id, { severity: null, issues: 0, completeness: 0, unverified: 0 });

  for (const issue of checkIntegrity(arch)) {
    if (!issue.component || issue.component === 'global') continue;
    const h = out.get(issue.component);
    if (!h) continue;
    h.issues++;
    if (!h.severity || SEV_RANK[issue.severity] > SEV_RANK[h.severity]) h.severity = issue.severity;
  }

  for (const c of arch.components ?? []) {
    const h = out.get(c.id)!;
    const factors: number[] = [];
    factors.push(isMissing(c.description) ? 0 : 1);
    factors.push(!isMissing(c.technology) && VERSION_REGEX.test(c.technology ?? '') ? 1 : 0);

    const eps = c.endpoints ?? [];
    if (eps.length) {
      factors.push(eps.filter((e) => (e.data_access ?? []).length > 0).length / eps.length);
      h.unverified = eps.filter((e) => validationStatus(e.validation) === 'unverified').length;
    }
    const tbs = c.tables ?? [];
    if (tbs.length) factors.push(tbs.filter((t) => !isMissing(t.purpose)).length / tbs.length);

    h.completeness = factors.length
      ? Math.round((factors.reduce((a, b) => a + b, 0) / factors.length) * 100)
      : 0;
  }

  return out;
}
