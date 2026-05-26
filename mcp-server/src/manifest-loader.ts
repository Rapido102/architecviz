import { readFileSync } from 'node:fs';
import { parseJsonc } from './jsonc.js';
import { MANIFEST_PATH } from './paths.js';

export interface ManifestSection {
  id: string;
  order: number;
  title: string;
  scope: string;
  extraction_pass: string;
  ai_prompt_ref?: string;
  json_path?: string;
  merge?: { strategy?: string; identity?: string[] };
  static_default?: unknown[];
  fields?: Record<string, unknown>;
  item_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Manifest {
  $manifest: string;
  version: string;
  applies_to: string;
  global: {
    missing_placeholder: string;
    overwrite_placeholder: boolean;
    warn_on_placeholder: boolean;
    manual_fields_global: string[];
    ai_confidence_threshold_default: number;
  };
  sections: ManifestSection[];
}

let cached: Manifest | null = null;

export function loadManifest(): Manifest {
  if (cached) return cached;
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  cached = parseJsonc<Manifest>(raw);
  return cached;
}

export function getSection(sectionId: string): ManifestSection {
  const manifest = loadManifest();
  const section = manifest.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new Error(
      `Unknown section "${sectionId}". Available: ${manifest.sections.map((s) => s.id).join(', ')}`,
    );
  }
  return section;
}

export function listSections() {
  const manifest = loadManifest();
  return manifest.sections.map((s) => ({
    id: s.id,
    order: s.order,
    title: s.title,
    scope: s.scope,
    extraction_pass: s.extraction_pass,
    ai_prompt_ref: s.ai_prompt_ref ?? null,
    merge_identity: s.merge?.identity ?? null,
  }));
}

/** Returns the static_default array for the "layers" section of the manifest. */
export function getDefaultLayers(): Array<Record<string, unknown>> {
  const section = getSection('layers');
  const defaults = section.static_default as Array<Record<string, unknown>> | undefined;
  return defaults ? JSON.parse(JSON.stringify(defaults)) : [];
}
