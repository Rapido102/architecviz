#!/usr/bin/env node
// Sync the canonical shared core into the MCP server's src tree before build.
// Source of truth: <repo>/src/core + <repo>/src/types.ts (hand-edited).
// Destination (generated, gitignored): mcp-server/src/core + mcp-server/src/types.ts
//
// This keeps a single edit-time source while letting the MCP server (a separate
// TS package) compile the shared logic into its own dist without monorepo tooling.

import { cpSync, copyFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = resolve(here, '..');
const repoRoot = resolve(mcpRoot, '..');

const srcCore = resolve(repoRoot, 'src', 'core');
const srcTypes = resolve(repoRoot, 'src', 'types.ts');

const destCore = resolve(mcpRoot, 'src', 'core');
const destTypes = resolve(mcpRoot, 'src', 'types.ts');

if (!existsSync(srcCore)) {
  console.error(`[sync-core] source introuvable: ${srcCore}`);
  process.exit(1);
}

// Clean previous copy
rmSync(destCore, { recursive: true, force: true });
mkdirSync(dirname(destCore), { recursive: true });

cpSync(srcCore, destCore, { recursive: true });
copyFileSync(srcTypes, destTypes);

// Node ESM (the MCP runtime) requires explicit .js extensions on relative imports.
// The React source uses extensionless imports (Vite resolves them). Rewrite the
// copied files so they work under Node ESM. Resolution is filesystem-aware:
//   ./x        → ./x.js        when ./x.ts exists
//   ./x        → ./x/index.js  when ./x/index.ts exists (directory import)
function rewriteImports(code, fileDir) {
  return code.replace(/(\bfrom\s+)(['"])(\.[^'"]+?)\2/g, (full, kw, q, path) => {
    if (/\.(js|json|mjs|cjs)$/.test(path)) return full;
    const asFile = resolve(fileDir, `${path}.ts`);
    const asIndex = resolve(fileDir, path, 'index.ts');
    let resolved;
    if (existsSync(asFile)) resolved = `${path}.js`;
    else if (existsSync(asIndex)) resolved = `${path}/index.js`;
    else resolved = `${path}.js`; // fallback
    return `${kw}${q}${resolved}${q}`;
  });
}

function processDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) processDir(full);
    else if (full.endsWith('.ts')) writeFileSync(full, rewriteImports(readFileSync(full, 'utf8'), dirname(full)), 'utf8');
  }
}

processDir(destCore);
writeFileSync(destTypes, rewriteImports(readFileSync(destTypes, 'utf8'), dirname(destTypes)), 'utf8');

console.log('[sync-core] copié + réécrit imports (.js) : src/core + src/types.ts → mcp-server/src/');
