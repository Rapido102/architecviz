import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

function readJson<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
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

  const component: Record<string, unknown> = {
    id,
    label,
    type: 'frontend',
    layer: 'Frontend',
    technology: tech.join(' + '),
    url: MISSING,
    build_tool: detectBuildTool(deps, pkg.scripts ?? {}),
    state_management: detectStateManagement(deps),
    routes: [],
    deployment: detectDeployment(projectPath),
  };

  return {
    fragment: [component],
    detected: true,
    notes: [
      'Routes non extraites — détection AST par framework non implémentée dans le MVP',
      'Compléter via Claude en lisant src/ et en appliquant prompts/sections/components-frontend.md#routes',
    ],
  };
}
