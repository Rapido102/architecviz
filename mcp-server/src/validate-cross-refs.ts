// Cross-reference validation: checks that component IDs referenced inside a
// staged fragment actually exist in the current architecture state (merged file
// + all other staged sections). Emits warnings (not errors) so staging is never
// blocked in multi-project flows where components arrive in any order.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECTURES_DIR } from './paths.js';
import { listStaged, readStagedEntry } from './staging.js';
import type { ValidationIssue } from './validation.js';

function collectKnownComponentIds(archName: string): Set<string> {
  const ids = new Set<string>();

  // From the already-merged architecture file.
  const file = resolve(ARCHITECTURES_DIR, `${archName}.json`);
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { components?: { id: string }[] };
      for (const c of data.components ?? []) if (c.id) ids.add(c.id);
    } catch { /* corrupt file — skip */ }
  }

  // From every staged component section (all projects).
  for (const entry of listStaged(archName)) {
    if (!entry.section_id.startsWith('components_')) continue;
    try {
      const frag = readStagedEntry(entry);
      if (Array.isArray(frag)) {
        for (const c of frag as { id?: string }[]) if (c.id) ids.add(c.id);
      }
    } catch { /* unreadable staged file — skip */ }
  }

  return ids;
}

function warn(path: string, message: string): ValidationIssue {
  return { path, rule: 'cross-ref', message, severity: 'warning' };
}

export function validateCrossRefs(
  archName: string,
  sectionId: string,
  fragment: unknown,
): ValidationIssue[] {
  // Only sections that carry inter-component references need this check.
  const CHECKED = new Set(['components_backend', 'components_external', 'connections']);
  if (!CHECKED.has(sectionId) || !Array.isArray(fragment)) return [];

  const known = collectKnownComponentIds(archName);
  // Also accept IDs defined in the fragment itself (intra-fragment self-references).
  for (const item of fragment as { id?: string }[]) if (item.id) known.add(item.id);

  const issues: ValidationIssue[] = [];

  if (sectionId === 'components_backend') {
    for (const [ci, comp] of (fragment as Record<string, unknown>[]).entries()) {
      const endpoints = (comp['endpoints'] ?? []) as {
        path?: string;
        data_access?: { component_id?: string }[];
      }[];
      for (const [ei, ep] of endpoints.entries()) {
        for (const [di, da] of (ep.data_access ?? []).entries()) {
          if (da.component_id && !known.has(da.component_id)) {
            issues.push(
              warn(
                `$[${ci}].endpoints[${ei}].data_access[${di}].component_id`,
                `"${da.component_id}" introuvable dans l'architecture — stager le composant cible avant ou corriger l'id`,
              ),
            );
          }
        }
      }
    }
  }

  if (sectionId === 'components_external') {
    for (const [ci, comp] of (fragment as Record<string, unknown>[]).entries()) {
      for (const [ui, id] of ((comp['used_by'] ?? []) as string[]).entries()) {
        if (!known.has(id)) {
          issues.push(
            warn(
              `$[${ci}].used_by[${ui}]`,
              `composant "${id}" référencé dans used_by introuvable — vérifier l'id du backend`,
            ),
          );
        }
      }
    }
  }

  if (sectionId === 'connections') {
    for (const [i, conn] of (fragment as Record<string, unknown>[]).entries()) {
      const from = conn['from'] as string | undefined;
      const to = conn['to'] as string | undefined;
      if (from && !known.has(from)) {
        issues.push(warn(`$[${i}].from`, `composant source "${from}" introuvable`));
      }
      if (to && !known.has(to)) {
        issues.push(warn(`$[${i}].to`, `composant cible "${to}" introuvable`));
      }
    }
  }

  return issues;
}
