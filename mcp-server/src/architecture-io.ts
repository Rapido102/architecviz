// Shared helpers for loading / creating / saving an architecture JSON file.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECTURES_DIR } from './paths.js';
import { getDefaultLayers } from './manifest-loader.js';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function targetFilePath(archName: string): string {
  return resolve(ARCHITECTURES_DIR, `${archName}.json`);
}

export function createDefaultArchitecture(archName: string): Record<string, unknown> {
  return {
    architecture: archName,
    type: 'OTHER',
    version: '0.1.0',
    lastUpdated: todayIso(),
    description: 'À confirmer',
    layers: getDefaultLayers(),
    components: [],
    connections: [],
  };
}

/**
 * Loads the architecture file if it exists, otherwise creates a default one in memory.
 * Also ensures `layers[]` is populated with manifest defaults when missing/empty
 * (the manifest section "layers" declares static_default which we apply here at load time).
 */
export function loadOrCreateArchitecture(archName: string): { arch: Record<string, unknown>; existed: boolean } {
  const file = targetFilePath(archName);
  let arch: Record<string, unknown>;
  let existed = false;

  if (existsSync(file)) {
    try {
      arch = JSON.parse(readFileSync(file, 'utf8'));
      existed = true;
    } catch {
      arch = createDefaultArchitecture(archName);
    }
  } else {
    arch = createDefaultArchitecture(archName);
  }

  // Apply layers default if missing/empty
  const layers = arch.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    arch.layers = getDefaultLayers();
  }

  return { arch, existed };
}

export function writeArchitecture(archName: string, arch: Record<string, unknown>): string {
  const file = targetFilePath(archName);
  writeFileSync(file, JSON.stringify(arch, null, 2) + '\n', 'utf8');
  return file;
}
