// Direct import — the jsoncPlugin in vite.config.ts strips comments and exports
// the parsed object as default.
import manifestRaw from '../../extraction-manifest.jsonc';
import type { Manifest, ManifestSection } from './types';

export const manifest = manifestRaw as unknown as Manifest;

export function getSection(id: string): ManifestSection {
  const section = manifest.sections.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown section "${id}"`);
  return section;
}

export function listSections(): ManifestSection[] {
  return [...manifest.sections].sort((a, b) => a.order - b.order);
}
