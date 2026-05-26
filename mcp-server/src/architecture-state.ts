// Helper to assemble the current architecture state for a given arch_name.
// Reads the merged file if it exists, then overlays any staged component
// sections that haven't been merged yet (staging wins). Used by tools that
// need to operate on the "current best guess" of the architecture without
// requiring the user to merge first.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECTURES_DIR } from './paths.js';
import { listStaged, readStagedEntry } from './staging.js';

interface ComponentLike {
  id: string;
  type: string;
  layer?: string;
  [key: string]: unknown;
}

export interface ArchitectureState {
  arch_name: string;
  merged_file_exists: boolean;
  components: ComponentLike[];
  source: { merged?: string; staging_overlays: string[] };
}

export function loadArchitectureState(archName: string): ArchitectureState {
  const targetFile = resolve(ARCHITECTURES_DIR, `${archName}.json`);
  let components: ComponentLike[] = [];
  const source: ArchitectureState['source'] = { staging_overlays: [] };

  if (existsSync(targetFile)) {
    try {
      const data = JSON.parse(readFileSync(targetFile, 'utf8')) as { components?: ComponentLike[] };
      components = Array.isArray(data.components) ? [...data.components] : [];
      source.merged = targetFile;
    } catch {
      /* corrupt file — treat as empty */
    }
  }

  // Overlay staged components_* sections (flat + every per-project slot)
  const staged = listStaged(archName);
  for (const s of staged) {
    if (!s.section_id.startsWith('components_')) continue;
    const fragment = readStagedEntry(s);
    if (!Array.isArray(fragment)) continue;
    source.staging_overlays.push(s.project_key ? `${s.project_key}/${s.section_id}` : s.section_id);

    for (const item of fragment as ComponentLike[]) {
      const idx = components.findIndex((c) => c.id === item.id);
      if (idx >= 0) {
        components[idx] = { ...components[idx], ...item };
      } else {
        components.push(item);
      }
    }
  }

  return {
    arch_name: archName,
    merged_file_exists: !!source.merged,
    components,
    source,
  };
}
