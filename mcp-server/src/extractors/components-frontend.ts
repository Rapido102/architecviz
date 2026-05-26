import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname, basename, extname } from 'node:path';

const MISSING = 'À confirmer';

const FRAMEWORKS = [
  { dep: 'next', label: 'Next.js' },
  { dep: 'react', label: 'React' },
  { dep: 'vue', label: 'Vue' },
  { dep: '@angular/core', label: 'Angular' },
  { dep: 'svelte', label: 'Svelte' },
  { dep: 'solid-js', label: 'SolidJS' },
] as const;

const BUNDLERS = [
  { dep: 'vite', label: 'Vite' },
  { dep: 'webpack', label: 'Webpack' },
  { dep: 'turbopack', label: 'Turbopack' },
  { dep: 'rspack', label: 'Rspack' },
  { dep: 'esbuild', label: 'esbuild' },
] as const;

const UI_KITS = ['tailwindcss', '@mui/material', 'antd', '@chakra-ui/react', '@mantine/core'];

const STATE_LIBS = [
  { dep: '@tanstack/react-query', role: 'server-state' },
  { dep: 'swr', role: 'server-state' },
  { dep: 'redux', role: 'client-state' },
  { dep: '@reduxjs/toolkit', role: 'client-state' },
  { dep: 'zustand', role: 'client-state' },
  { dep: 'jotai', role: 'client-state' },
  { dep: 'mobx', role: 'client-state' },
  { dep: 'pinia', role: 'client-state' },
  { dep: 'react-hook-form', role: 'form-state' },
  { dep: 'formik', role: 'form-state' },
] as const;

// ── file system helpers ─────────────────────────────────────────────────────

const SRC_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  '__tests__', '__mocks__', '.turbo', 'coverage', '.cache',
]);

function walkSrc(dir: string, maxDepth = 8): string[] {
  const out: string[] = [];
  const rec = (d: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      const full = join(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) rec(full, depth + 1);
      else if (SRC_EXTS.has(extname(e))) out.push(full);
    }
  };
  rec(dir, 0);
  return out;
}

function readFileSafe(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function readJson<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}

function stripVersion(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, '').trim();
}

function slugify(s: string): string {
  return s
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function humanize(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Convert a Next.js file path (relative to pages/ or app/) into a URL path.
// e.g. "users/[id].tsx" → "/users/{id}", "index.tsx" → "/"
function nextFileToRoutePath(relPath: string): string {
  let p = relPath.replace(/\\/g, '/');
  p = p.replace(/\.(tsx?|jsx?)$/, '');
  p = p.replace(/(^|\/)index$/, '') || '/';
  if (!p.startsWith('/')) p = '/' + p;
  // [...slug] → :slug* (catch-all), [param] → {param}
  p = p.replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, '{$1}');
  return p || '/';
}

function fileLabel(fileName: string): string {
  const name = basename(fileName, extname(fileName));
  if (name === 'index') return 'Home';
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── api_calls extraction from a single source file ──────────────────────────

function extractApiCallsFromFile(filePath: string): string[] {
  const src = readFileSafe(filePath);
  if (!src) return [];
  const calls = new Set<string>();

  function addCall(method: string, rawPath: string) {
    // Normalize template literal variables to {param}
    let p = rawPath.replace(/\$\{[^}]+\}/g, '{param}');
    // Strip query strings
    p = p.split('?')[0];
    // Skip obvious non-API paths (static files, full URLs)
    if (p.length <= 1 || p.includes('.') || p.startsWith('http')) return;
    calls.add(`${method.toUpperCase()} ${p}`);
  }

  // fetch('/path') — method defaults to GET unless overridden nearby
  for (const m of src.matchAll(/\bfetch\s*\(\s*[`'"](\/[^`'"<>\s]+)[`'"]/g)) {
    const after = src.slice(m.index!, m.index! + 300);
    const meth = after.match(/method\s*:\s*[`'"](\w+)[`'"]/)?.[1] ?? 'GET';
    addCall(meth, m[1]);
  }

  // axios.get / axios.post / …
  for (const m of src.matchAll(/\baxios\.(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"<>\s]+)[`'"]/g)) {
    addCall(m[1], m[2]);
  }

  // api.get / http.get / client.get / httpClient.get / request.get / service.get
  for (const m of src.matchAll(/\b(?:api|http|client|httpClient|request|service)\.(get|post|put|patch|delete)\s*\(\s*[`'"](\/[^`'"<>\s]+)[`'"]/g)) {
    addCall(m[1], m[2]);
  }

  // Angular HttpClient: this.http.get<T>('/path')
  for (const m of src.matchAll(/this\.http\.(get|post|put|patch|delete)(?:<[^>]+>)?\s*\(\s*[`'"](\/[^`'"<>\s]+)[`'"]/g)) {
    addCall(m[1], m[2]);
  }

  // useQuery / useMutation with path literal as second arg or inside fetcher
  // useQuery(['key'], () => fetch('/path')) — already captured by fetch pattern above
  // useSWR('/path', fetcher)
  for (const m of src.matchAll(/\buseSWR\s*\(\s*[`'"](\/[^`'"<>\s]+)[`'"]/g)) {
    addCall('GET', m[1]);
  }

  return [...calls];
}

// ── per-framework route extractors ──────────────────────────────────────────

interface RouteFragment {
  path: string;
  label?: string;
  api_calls: string[];
  authenticated?: boolean;
}

// Next.js pages/ directory: each .tsx/.ts/.jsx/.js file = one route.
// Scans the page file itself for API calls.
function extractNextPagesRoutes(projectPath: string): RouteFragment[] {
  const pagesDir = resolve(projectPath, 'pages');
  if (!existsSync(pagesDir)) return [];
  const routes: RouteFragment[] = [];

  const rec = (dir: string, relBase: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e)) rec(full, join(relBase, e));
      } else if (SRC_EXTS.has(extname(e))) {
        const relFile = join(relBase, e);
        const name = basename(e, extname(e));
        // Skip _app, _document, _error, api/ routes
        if (name.startsWith('_') || relBase.replace(/\\/g, '/').startsWith('api')) continue;
        const path = nextFileToRoutePath(relFile);
        routes.push({ path, label: fileLabel(e), api_calls: extractApiCallsFromFile(full) });
      }
    }
  };
  rec(pagesDir, '');
  return routes;
}

// Next.js app/ directory: each page.tsx in any subdirectory = one route.
// Scans the page.tsx file for API calls.
function extractNextAppRoutes(projectPath: string): RouteFragment[] {
  const appDir = resolve(projectPath, 'app');
  if (!existsSync(appDir)) return [];
  const routes: RouteFragment[] = [];

  const rec = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e)) rec(full);
      } else if (/^page\.(tsx?|jsx?)$/.test(e)) {
        const relDir = relative(appDir, dir).replace(/\\/g, '/');
        let path = relDir ? '/' + relDir : '/';
        // (route-groups) are transparent: strip (...) segments
        path = path.replace(/\/\([^)]+\)/g, '');
        path = path.replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, '{$1}');
        routes.push({ path: path || '/', api_calls: extractApiCallsFromFile(full) });
      }
    }
  };
  rec(appDir);
  return routes;
}

// React Router: scan routing/app files for path declarations.
// api_calls are left empty — component→route mapping would need AST.
function extractReactRouterRoutes(projectPath: string): RouteFragment[] {
  const srcDir = resolve(projectPath, 'src');
  if (!existsSync(srcDir)) return [];

  // Common naming conventions for router config files
  const ROUTER_FILE_RE = /(?:^|\/)(?:router|routes?|routing|App)\.(tsx?|jsx?)$/i;
  const files = walkSrc(srcDir, 3).filter((f) => ROUTER_FILE_RE.test(f));
  if (files.length === 0) return [];

  const paths = new Map<string, RouteFragment>();
  for (const f of files) {
    const src = readFileSafe(f);
    if (!src) continue;
    // path="..." or path: "..." in JSX <Route> or object configs
    for (const m of src.matchAll(/\bpath\s*[=:]\s*[`'"](\/[^`'"<>\s*{}]+)[`'"]/g)) {
      const p = m[1];
      if (!paths.has(p)) paths.set(p, { path: p, api_calls: [] });
    }
  }
  return [...paths.values()];
}

// Vue Router: scan router/index.ts for route path declarations.
function extractVueRouterRoutes(projectPath: string): RouteFragment[] {
  const candidates = [
    resolve(projectPath, 'src', 'router', 'index.ts'),
    resolve(projectPath, 'src', 'router', 'index.js'),
    resolve(projectPath, 'src', 'router.ts'),
    resolve(projectPath, 'src', 'router.js'),
  ];
  const routerFile = candidates.find(existsSync);
  if (!routerFile) return [];
  const src = readFileSafe(routerFile);
  if (!src) return [];

  const paths = new Set<string>();
  for (const m of src.matchAll(/\bpath\s*:\s*[`'"]((?:\/)[^`'"]+)[`'"]/g)) {
    const p = m[1];
    if (p !== '*' && p !== '**') paths.add(p);
  }
  return [...paths].map((p) => ({ path: p, api_calls: [] }));
}

// Angular Router: scan *.routing.module.ts / *.routing.ts / *.routes.ts for paths.
function extractAngularRoutes(projectPath: string): RouteFragment[] {
  const srcDir = resolve(projectPath, 'src');
  if (!existsSync(srcDir)) return [];

  const ROUTING_FILE_RE = /\.(?:routing(?:\.module)?|routes)\.ts$/;
  const files = walkSrc(srcDir, 6).filter((f) => ROUTING_FILE_RE.test(basename(f)));
  if (files.length === 0) return [];

  const paths = new Set<string>();
  for (const f of files) {
    const src = readFileSafe(f);
    if (!src) continue;
    for (const m of src.matchAll(/\bpath\s*:\s*[`'"]((?:\/)?[^`'"{}*]+)[`'"]/g)) {
      const p = m[1].trim();
      if (!p || p === '**') continue;
      paths.add(p.startsWith('/') ? p : '/' + p);
    }
  }
  return [...paths].map((p) => ({ path: p, api_calls: [] }));
}

// Dispatcher: pick the right extractor based on detected framework/deps.
function extractRoutes(
  projectPath: string,
  deps: Record<string, string>,
): { routes: RouteFragment[]; source: string; notes: string[] } {
  const notes: string[] = [];

  if (deps['next']) {
    const app = extractNextAppRoutes(projectPath);
    if (app.length > 0) {
      const withCalls = app.filter((r) => r.api_calls.length > 0).length;
      notes.push(`${app.length} route(s) extraites depuis app/ (Next.js App Router) — ${withCalls} avec api_calls détectés`);
      return { routes: app, source: 'next-app-router', notes };
    }
    const pages = extractNextPagesRoutes(projectPath);
    if (pages.length > 0) {
      const withCalls = pages.filter((r) => r.api_calls.length > 0).length;
      notes.push(`${pages.length} route(s) extraites depuis pages/ (Next.js Pages Router) — ${withCalls} avec api_calls détectés`);
      return { routes: pages, source: 'next-pages-router', notes };
    }
    notes.push('Next.js détecté mais ni app/ ni pages/ non-vides trouvés');
  }

  if (deps['react']) {
    const rr = extractReactRouterRoutes(projectPath);
    if (rr.length > 0) {
      notes.push(`${rr.length} route(s) extraites depuis fichiers router (React Router) — api_calls à compléter par Claude`);
      return { routes: rr, source: 'react-router', notes };
    }
  }

  if (deps['vue'] || deps['nuxt']) {
    const vr = extractVueRouterRoutes(projectPath);
    if (vr.length > 0) {
      notes.push(`${vr.length} route(s) extraites depuis router/ (Vue Router) — api_calls à compléter par Claude`);
      return { routes: vr, source: 'vue-router', notes };
    }
  }

  if (deps['@angular/core']) {
    const ng = extractAngularRoutes(projectPath);
    if (ng.length > 0) {
      notes.push(`${ng.length} route(s) extraites depuis routing modules (Angular) — api_calls à compléter par Claude`);
      return { routes: ng, source: 'angular-router', notes };
    }
  }

  notes.push(
    'Routes non extraites automatiquement — compléter via Claude en lisant src/ et en appliquant prompts/sections/components-frontend.md#routes',
  );
  return { routes: [], source: 'none', notes };
}

// ── tech detection (unchanged) ───────────────────────────────────────────────

interface PackageJson {
  name?: string;
  displayName?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function detectFramework(deps: Record<string, string>): { tech: string[]; ok: boolean } {
  const tech: string[] = [];
  for (const { dep, label } of FRAMEWORKS) {
    if (deps[dep]) {
      tech.push(`${label} ${stripVersion(deps[dep])}`);
      break;
    }
  }
  for (const { dep, label } of BUNDLERS) {
    if (deps[dep]) {
      tech.push(`${label} ${stripVersion(deps[dep])}`);
      break;
    }
  }
  for (const kit of UI_KITS) {
    if (deps[kit]) tech.push(`${kit} ${stripVersion(deps[kit])}`);
  }
  return { tech, ok: tech.length > 0 };
}

function detectStateManagement(deps: Record<string, string>): string {
  const parts: string[] = [];
  for (const { dep, role } of STATE_LIBS) {
    if (deps[dep]) parts.push(`${dep} ${stripVersion(deps[dep])} (${role})`);
  }
  return parts.length > 0 ? parts.join(' + ') : MISSING;
}

function detectBuildTool(deps: Record<string, string>, scripts: Record<string, string>): string {
  for (const { dep, label } of BUNDLERS) {
    if (deps[dep]) return `${label} ${stripVersion(deps[dep])}`;
  }
  const build = scripts.build ?? '';
  for (const { dep, label } of BUNDLERS) {
    if (build.includes(dep)) return label;
  }
  return MISSING;
}

function detectDeployment(projectPath: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (existsSync(resolve(projectPath, 'Dockerfile'))) {
    out.containerized = true;
    out.platform = 'Docker';
  }
  if (existsSync(resolve(projectPath, '.gitlab-ci.yml'))) out.ci_cd = 'GitLab CI';
  else if (existsSync(resolve(projectPath, '.github', 'workflows'))) out.ci_cd = 'GitHub Actions';
  else if (existsSync(resolve(projectPath, 'Jenkinsfile'))) out.ci_cd = 'Jenkins';
  if (
    existsSync(resolve(projectPath, 'helm')) ||
    existsSync(resolve(projectPath, 'k8s')) ||
    existsSync(resolve(projectPath, 'manifests'))
  ) {
    out.orchestration = 'Kubernetes';
  }
  if (Object.keys(out).length === 0) return { platform: MISSING };
  return out;
}

// ── public API ───────────────────────────────────────────────────────────────

export function extractFrontendComponents(projectPath: string): {
  fragment: Record<string, unknown>[];
  detected: boolean;
  notes: string[];
} {
  const pkg = readJson<PackageJson>(resolve(projectPath, 'package.json'));
  if (!pkg) {
    return { fragment: [], detected: false, notes: ['Pas de package.json trouvé — aucun composant frontend détecté'] };
  }

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const { tech, ok } = detectFramework(deps);
  if (!ok) {
    return {
      fragment: [],
      detected: false,
      notes: ['Aucun framework frontend (React/Vue/Angular/Next/Svelte) détecté dans package.json'],
    };
  }

  const id = slugify(pkg.name ?? 'frontend');
  const label = pkg.displayName ?? humanize(id);

  const { routes, source, notes: routeNotes } = extractRoutes(projectPath, deps);

  const component: Record<string, unknown> = {
    id,
    label,
    type: 'frontend',
    layer: 'Frontend',
    technology: tech.join(' + '),
    url: MISSING,
    build_tool: detectBuildTool(deps, pkg.scripts ?? {}),
    state_management: detectStateManagement(deps),
    routes,
    deployment: detectDeployment(projectPath),
  };

  const notes = [...routeNotes];
  if (routes.length === 0) {
    notes.push('Compléter via Claude en lisant src/ et en appliquant prompts/sections/components-frontend.md#routes');
  } else if (source !== 'next-app-router' && source !== 'next-pages-router') {
    notes.push('api_calls non détectés pour frameworks non-Next.js — les associer par route via Claude (get_section_prompt components_frontend)');
  }

  return { fragment: [component], detected: true, notes };
}
