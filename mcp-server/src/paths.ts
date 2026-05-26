import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// dist/ at runtime, src/ in dev — go up to mcp-server/, then up to repo root.
export const REPO_ROOT = resolve(here, '..', '..');

export const MANIFEST_PATH = resolve(REPO_ROOT, 'extraction-manifest.jsonc');
export const PROMPTS_DIR = resolve(REPO_ROOT, 'prompts', 'sections');
export const ARCHITECTURES_DIR = resolve(REPO_ROOT, 'src', 'architectures');
export const STAGING_ROOT = resolve(REPO_ROOT, '.architectviz', 'staging');
