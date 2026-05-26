// derive_cross_links — read every architecture file, resolve cross-architecture
// links deterministically, and (optionally) persist explicit `external_ref` on the
// referencing components so the relationship is auditable instead of heuristic.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHITECTURES_DIR } from '../paths.js';
import { parseJsonc } from '../jsonc.js';
import { resolveCrossLinks, type ArchRef, type CrossLink } from '../core/crossLinks.js';
import type { ArchitectureConfig, Component } from '../types.js';

function loadRegistry(): ArchRef[] {
  let files: string[];
  try {
    files = readdirSync(ARCHITECTURES_DIR).filter((f) => /\.jsonc?$/.test(f));
  } catch {
    return [];
  }
  const reg: ArchRef[] = [];
  for (const f of files) {
    try {
      const data = parseJsonc<ArchitectureConfig>(readFileSync(resolve(ARCHITECTURES_DIR, f), 'utf8'));
      reg.push({ id: f.replace(/\.jsonc?$/, ''), name: data.architecture || f, data });
    } catch {
      /* skip unparseable */
    }
  }
  return reg;
}

type Action = 'set' | 'already' | 'conflict' | 'skipped_low_confidence';

interface Proposal {
  arch: string;
  component_id: string;
  component_label: string;
  target_arch: string;
  target_name: string;
  canonical_ref: string;
  current_external_ref?: string;
  confidence: number;
  reason: string;
  action: Action;
}

export interface DeriveCrossLinksResult {
  status: string;
  registry: string[];
  total_links: number;
  proposals: Proposal[];
  written?: { file: string; refs_set: number };
}

function normalize(s?: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function deriveCrossLinks(opts: { arch_name?: string; write?: boolean; min_confidence?: number } = {}): DeriveCrossLinksResult {
  const minConf = opts.min_confidence ?? 0.8;
  const registry = loadRegistry();
  const allLinks = resolveCrossLinks(registry);
  const links = opts.arch_name ? allLinks.filter((l) => l.fromArchId === opts.arch_name) : allLinks;

  const compIndex = new Map<string, Map<string, Component>>();
  for (const a of registry) {
    const m = new Map<string, Component>();
    for (const c of a.data.components ?? []) m.set(c.id, c);
    compIndex.set(a.id, m);
  }

  const proposals: Proposal[] = links.map((l: CrossLink) => {
    const comp = compIndex.get(l.fromArchId)?.get(l.fromComponentId);
    const current = comp?.external_ref;
    const canonical = l.toArchId; // canonical slug = target file id
    let action: Action;
    if (current && normalize(current) === normalize(canonical)) action = 'already';
    else if (current) action = 'conflict';
    else if (l.confidence < minConf) action = 'skipped_low_confidence';
    else action = 'set';
    return {
      arch: l.fromArchId,
      component_id: l.fromComponentId,
      component_label: l.fromComponentLabel,
      target_arch: l.toArchId,
      target_name: l.toArchName,
      canonical_ref: canonical,
      current_external_ref: current,
      confidence: l.confidence,
      reason: l.reason,
      action,
    };
  });

  const result: DeriveCrossLinksResult = {
    status: opts.write ? 'written' : 'dry-run',
    registry: registry.map((r) => `${r.id} (${r.name})`),
    total_links: links.length,
    proposals,
  };

  // Persist only when explicitly asked and scoped to one architecture.
  if (opts.write && opts.arch_name) {
    const file = resolve(ARCHITECTURES_DIR, `${opts.arch_name}.json`);
    let arch: ArchitectureConfig;
    try {
      arch = parseJsonc<ArchitectureConfig>(readFileSync(file, 'utf8'));
    } catch {
      return { ...result, status: 'no_file', written: { file, refs_set: 0 } };
    }
    let count = 0;
    for (const p of proposals) {
      if (p.action !== 'set') continue;
      const comp = (arch.components ?? []).find((c) => c.id === p.component_id);
      if (comp) {
        comp.external_ref = p.canonical_ref;
        count++;
      }
    }
    if (count > 0) writeFileSync(file, JSON.stringify(arch, null, 2) + '\n', 'utf8');
    result.written = { file, refs_set: count };
  }

  return result;
}
