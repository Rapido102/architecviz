import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { STAGING_ROOT } from './paths.js';

// Staging layout:
//   <arch>/<section>.json                          ← singleton sections (identity, layers, connections, flow_summary_and_warnings)
//   <arch>/projects/<project_key>/<section>.json   ← per-project component sections (components_*)
//
// Component sections are per-project so several projects (e.g. microservices) can
// contribute under the same arch_name without overwriting each other. At merge time
// every project's component fragments are merged into $.components (dedup by id).

const COMPONENT_SECTION = /^components_/;
const ID_RE = /^[a-z0-9_-]+$/i;
const SECTION_RE = /^[a-z0-9_]+$/;

function archDir(archName: string): string {
  if (!ID_RE.test(archName)) throw new Error(`Invalid arch_name "${archName}" — must match [a-zA-Z0-9_-]+`);
  return resolve(STAGING_ROOT, archName);
}
function projectsDir(archName: string): string {
  return join(archDir(archName), 'projects');
}
function projectDir(archName: string, projectKey: string): string {
  if (!ID_RE.test(projectKey)) throw new Error(`Invalid project_key "${projectKey}" — must match [a-zA-Z0-9_-]+`);
  return join(projectsDir(archName), projectKey);
}
function checkSection(sectionId: string): void {
  if (!SECTION_RE.test(sectionId)) throw new Error(`Invalid section_id "${sectionId}"`);
}

function flatPath(archName: string, sectionId: string): string {
  checkSection(sectionId);
  return join(archDir(archName), `${sectionId}.json`);
}
function projectFragmentPath(archName: string, projectKey: string, sectionId: string): string {
  checkSection(sectionId);
  return join(projectDir(archName, projectKey), `${sectionId}.json`);
}

export interface StagedEntry {
  section_id: string;
  project_key: string | null;
  path: string;
}

/**
 * Stage a fragment.
 * - Component sections (components_*) with a projectKey → per-project slot.
 * - Everything else (or no projectKey) → flat singleton slot.
 */
export function stageFragment(
  archName: string,
  sectionId: string,
  fragment: unknown,
  projectKey?: string,
): { path: string; bytes: number } {
  let target: string;
  if (projectKey && COMPONENT_SECTION.test(sectionId)) {
    const dir = projectDir(archName, projectKey);
    mkdirSync(dir, { recursive: true });
    target = projectFragmentPath(archName, projectKey, sectionId);
  } else {
    mkdirSync(archDir(archName), { recursive: true });
    target = flatPath(archName, sectionId);
  }
  const content = JSON.stringify(fragment, null, 2);
  writeFileSync(target, content + '\n', 'utf8');
  return { path: target, bytes: content.length };
}

/** List all staged fragments — flat singletons + every per-project component fragment. */
export function listStaged(archName: string): StagedEntry[] {
  const out: StagedEntry[] = [];
  const dir = archDir(archName);
  if (!existsSync(dir)) return out;

  // Flat singleton sections (skip the `projects` directory)
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    out.push({ section_id: f.replace(/\.json$/, ''), project_key: null, path: join(dir, f) });
  }

  // Per-project component sections
  const pdir = projectsDir(archName);
  if (existsSync(pdir)) {
    for (const key of readdirSync(pdir)) {
      const kdir = join(pdir, key);
      try { if (!statSync(kdir).isDirectory()) continue; } catch { continue; }
      for (const f of readdirSync(kdir)) {
        if (!f.endsWith('.json')) continue;
        out.push({ section_id: f.replace(/\.json$/, ''), project_key: key, path: join(kdir, f) });
      }
    }
  }

  return out;
}

export function readStagedEntry(entry: StagedEntry): unknown {
  return JSON.parse(readFileSync(entry.path, 'utf8'));
}

/** Read a specific fragment (flat by default, or per-project if projectKey given). */
export function readStaged(archName: string, sectionId: string, projectKey?: string): unknown {
  const path = projectKey && COMPONENT_SECTION.test(sectionId)
    ? projectFragmentPath(archName, projectKey, sectionId)
    : flatPath(archName, sectionId);
  if (!existsSync(path)) throw new Error(`No staged fragment for ${archName}/${projectKey ?? ''}/${sectionId}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
