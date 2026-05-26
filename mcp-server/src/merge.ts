import { getSection } from './manifest-loader.js';
// Shared primitive — single source of truth in <repo>/src/core/merge.ts (synced).
export { mergeListByIdentity } from './core/merge.js';
import { mergeListByIdentity } from './core/merge.js';

export interface MergeResult {
  section_id: string;
  strategy: 'list-by-identity' | 'object-merge' | 'replace';
  added: number;
  updated: number;
  identity: string[] | null;
}

export function mergeFragmentIntoArchitecture(
  arch: Record<string, unknown>,
  sectionId: string,
  fragment: unknown,
): MergeResult {
  const section = getSection(sectionId);

  // Special-case sections that don't map to a single top-level key.
  if (sectionId === 'identity') {
    Object.assign(arch, fragment as Record<string, unknown>);
    return { section_id: sectionId, strategy: 'object-merge', added: 0, updated: 1, identity: null };
  }

  if (sectionId === 'flow_summary_and_warnings') {
    const f = fragment as { flow_summary?: unknown; warnings?: unknown[] };
    if (f.flow_summary) arch.flow_summary = f.flow_summary;
    if (f.warnings) {
      const baseWarnings = (arch.warnings as Record<string, unknown>[]) ?? [];
      const result = mergeListByIdentity(
        baseWarnings,
        f.warnings as Record<string, unknown>[],
        ['severity', 'message', 'component'],
      );
      arch.warnings = result.merged;
      return { section_id: sectionId, strategy: 'list-by-identity', ...result, identity: ['severity', 'message', 'component'] };
    }
    return { section_id: sectionId, strategy: 'object-merge', added: 0, updated: 1, identity: null };
  }

  // Component sections all merge into $.components by id.
  if (sectionId.startsWith('components_')) {
    const baseList = (arch.components as Record<string, unknown>[]) ?? [];
    const result = mergeListByIdentity(
      baseList,
      fragment as Record<string, unknown>[],
      ['id'],
    );
    arch.components = result.merged;
    return { section_id: sectionId, strategy: 'list-by-identity', ...result, identity: ['id'] };
  }

  // Layers / connections / etc — generic list-by-identity.
  const identity = section.merge?.identity ?? ['id'];
  const topKey = sectionId; // layers, connections
  const baseList = (arch[topKey] as Record<string, unknown>[]) ?? [];
  const result = mergeListByIdentity(
    baseList,
    fragment as Record<string, unknown>[],
    identity,
  );
  arch[topKey] = result.merged;
  return { section_id: sectionId, strategy: 'list-by-identity', ...result, identity };
}
