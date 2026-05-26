import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const MISSING = 'À confirmer';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function humanize(slug: string): string {
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function extractFromPackageJson(projectPath: string): Partial<Identity> {
  const raw = readIfExists(resolve(projectPath, 'package.json'));
  if (!raw) return {};
  try {
    const pkg = JSON.parse(raw) as { name?: string; description?: string; version?: string };
    const out: Partial<Identity> = {};
    if (pkg.name) out.architecture = humanize(pkg.name.replace(/^@[^/]+\//, ''));
    if (pkg.description) out.description = pkg.description;
    return out;
  } catch {
    return {};
  }
}

function extractFromPomXml(projectPath: string): Partial<Identity> {
  const raw = readIfExists(resolve(projectPath, 'pom.xml'));
  if (!raw) return {};
  const out: Partial<Identity> = {};
  const artifactId = raw.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  if (artifactId) out.architecture = humanize(artifactId);
  const description = raw.match(/<description>([^<]+)<\/description>/)?.[1]?.trim();
  if (description) out.description = description;
  return out;
}

function extractFromPyproject(projectPath: string): Partial<Identity> {
  const raw = readIfExists(resolve(projectPath, 'pyproject.toml'));
  if (!raw) return {};
  const out: Partial<Identity> = {};
  const name =
    raw.match(/\[tool\.poetry\][^[]*?name\s*=\s*"([^"]+)"/s)?.[1] ??
    raw.match(/\[project\][^[]*?name\s*=\s*"([^"]+)"/s)?.[1];
  if (name) out.architecture = humanize(name);
  const description =
    raw.match(/\[tool\.poetry\][^[]*?description\s*=\s*"([^"]+)"/s)?.[1] ??
    raw.match(/\[project\][^[]*?description\s*=\s*"([^"]+)"/s)?.[1];
  if (description) out.description = description;
  return out;
}

function extractFromReadme(projectPath: string): Partial<Identity> {
  const candidates = ['README.md', 'readme.md', 'README.MD'];
  for (const name of candidates) {
    const raw = readIfExists(resolve(projectPath, name));
    if (!raw) continue;
    const out: Partial<Identity> = {};
    const h1 = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (h1) out.architecture = h1.replace(/[*_`]/g, '');
    const afterH1 = raw.split(/^#\s+.+$/m).slice(1).join('\n').trim();
    const firstPara = afterH1.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('#'))?.trim();
    if (firstPara) out.description = firstPara.replace(/\s+/g, ' ').slice(0, 400);
    return out;
  }
  return {};
}

export interface Identity {
  architecture: string;
  type: string;
  version: string;
  lastUpdated: string;
  description: string;
}

export function extractIdentity(projectPath: string): {
  fragment: Identity;
  sources_used: string[];
  fields_resolved: string[];
  fields_missing: string[];
} {
  const sourcesUsed: string[] = [];
  const partial: Partial<Identity> = {};

  const sources: Array<[string, () => Partial<Identity>]> = [
    ['package.json', () => extractFromPackageJson(projectPath)],
    ['pom.xml', () => extractFromPomXml(projectPath)],
    ['pyproject.toml', () => extractFromPyproject(projectPath)],
    ['README.md', () => extractFromReadme(projectPath)],
  ];

  for (const [name, fn] of sources) {
    const found = fn();
    if (Object.keys(found).length === 0) continue;
    sourcesUsed.push(name);
    for (const [key, value] of Object.entries(found)) {
      if (!(key in partial) && value) {
        (partial as Record<string, unknown>)[key] = value;
      }
    }
  }

  if (!partial.architecture) {
    partial.architecture = humanize(basename(resolve(projectPath)));
  }

  const fragment: Identity = {
    architecture: partial.architecture ?? MISSING,
    type: MISSING,
    version: '0.1.0',
    lastUpdated: todayIso(),
    description: partial.description ?? MISSING,
  };

  const allFields = Object.keys(fragment) as (keyof Identity)[];
  const fieldsMissing = allFields.filter((k) => fragment[k] === MISSING);
  const fieldsResolved = allFields.filter((k) => fragment[k] !== MISSING);

  return { fragment, sources_used: sourcesUsed, fields_resolved: fieldsResolved, fields_missing: fieldsMissing };
}
