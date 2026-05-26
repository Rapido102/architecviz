// Pure cross-architecture link resolver.
// Given the registry of all loaded architectures, detect when a component in one
// architecture actually *is* another architecture (e.g. isicrm's `flowdistribution_api`
// third-party == the "Bo Flow Distribution" architecture). No React, no fs.

import type { ArchitectureConfig, Component } from '../types';

export interface ArchRef {
  id: string; // file-derived id (e.g. "curseur")
  name: string; // data.architecture (e.g. "Bo Flow Distribution")
  data: ArchitectureConfig;
}

export interface CrossLink {
  fromArchId: string;
  fromArchName: string;
  fromComponentId: string;
  fromComponentLabel: string;
  toArchId: string;
  toArchName: string;
  confidence: number; // 0..1
  reason: string;
}

// Component types that can plausibly represent a whole other architecture.
const LINKABLE_TYPES = new Set(['third-party', 'service', 'backend', 'frontend', 'etl', 'batch']);

// Generic words that carry no identity signal.
const STOPWORDS = new Set([
  'api', 'service', 'services', 'back', 'backend', 'front', 'frontend', 'bo', 'app',
  'the', 'de', 'du', 'des', 'le', 'la', 'srv', 'ws', 'rest', 'http',
]);

const MIN_CONFIDENCE = 0.72;

function normalize(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenize(s: string): Set<string> {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((t) => !STOPWORDS.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): { shared: number; jaccard: number } {
  if (a.size === 0 || b.size === 0) return { shared: 0, jaccard: 0 };
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return { shared: inter, jaccard: inter / (a.size + b.size - inter) };
}

/** Strings & token-sets that other architectures would use to reference architecture B. */
interface Identity {
  norms: Set<string>; // normalized full strings (archName, file id, primary comp ids/labels)
  tokenSets: { tokens: Set<string>; source: string }[];
}

function buildIdentity(arch: ArchRef): Identity {
  const norms = new Set<string>([normalize(arch.name), normalize(arch.id)]);
  const tokenSets = [{ tokens: tokenize(arch.name), source: `nom « ${arch.name} »` }];

  for (const c of arch.data.components ?? []) {
    if (c.type !== 'backend' && c.type !== 'frontend') continue; // the parts B exposes
    norms.add(normalize(c.label));
    norms.add(normalize(c.id));
    tokenSets.push({ tokens: tokenize(c.label), source: `composant « ${c.label} »` });
  }
  return { norms, tokenSets };
}

interface MatchResult {
  confidence: number;
  reason: string;
}

function scoreComponentAgainst(comp: Component, identity: Identity, archName: string): MatchResult {
  const cIdNorm = normalize(comp.id);
  const cLabelNorm = normalize(comp.label);
  const cTokens = new Set<string>([...tokenize(comp.id), ...tokenize(comp.label)]);

  let best: MatchResult = { confidence: 0, reason: '' };
  const consider = (confidence: number, reason: string) => {
    if (confidence > best.confidence) best = { confidence, reason };
  };

  // 1) Exact normalized equality (id or label) with any identity string → very strong.
  for (const n of identity.norms) {
    if (!n) continue;
    if (n === cIdNorm || n === cLabelNorm) {
      consider(0.97, `correspondance exacte avec « ${archName} »`);
    }
  }

  // 2) Substring containment between concatenated identity & component strings.
  const compConcat = cIdNorm + cLabelNorm;
  for (const n of identity.norms) {
    if (n.length < 4) continue;
    if (compConcat.includes(n) || (cLabelNorm.length >= 4 && n.includes(cLabelNorm))) {
      consider(0.76, `« ${comp.label} » référence « ${archName} »`);
    }
  }

  // 3) Token overlap against arch name / primary component labels.
  // Require at least 2 shared tokens — a single generic token (e.g. "crm") is too noisy.
  for (const ts of identity.tokenSets) {
    const { shared, jaccard } = overlap(cTokens, ts.tokens);
    if (shared >= 2) consider(0.6 + 0.35 * jaccard, `tokens communs avec ${ts.source}`);
  }

  return best;
}

/**
 * Resolve every cross-architecture link in the registry.
 * For each architecture, each linkable component is matched against all *other*
 * architectures; the best match above the confidence threshold is kept.
 */
/** Resolve an explicit `external_ref` string to a registry architecture, if any. */
function resolveExplicitRef(ref: string, registry: ArchRef[], selfId: string): ArchRef | null {
  const r = normalize(ref);
  if (!r) return null;
  return (
    registry.find((a) => a.id !== selfId && (normalize(a.id) === r || normalize(a.name) === r)) ?? null
  );
}

export function resolveCrossLinks(registry: ArchRef[]): CrossLink[] {
  const identities = new Map<string, Identity>();
  for (const arch of registry) identities.set(arch.id, buildIdentity(arch));

  const links: CrossLink[] = [];
  for (const from of registry) {
    for (const comp of from.data.components ?? []) {
      // 0) Explicit link emitted by the MCP server — authoritative, skip heuristics.
      if (comp.external_ref) {
        const target = resolveExplicitRef(comp.external_ref, registry, from.id);
        if (target) {
          links.push({
            fromArchId: from.id,
            fromArchName: from.name,
            fromComponentId: comp.id,
            fromComponentLabel: comp.label,
            toArchId: target.id,
            toArchName: target.name,
            confidence: 1,
            reason: `external_ref explicite « ${comp.external_ref} »`,
          });
          continue;
        }
      }

      if (!LINKABLE_TYPES.has(comp.type as string)) continue;

      let bestArch: ArchRef | null = null;
      let bestMatch: MatchResult = { confidence: 0, reason: '' };

      for (const to of registry) {
        if (to.id === from.id) continue;
        const m = scoreComponentAgainst(comp, identities.get(to.id)!, to.name);
        if (m.confidence > bestMatch.confidence) {
          bestMatch = m;
          bestArch = to;
        }
      }

      if (bestArch && bestMatch.confidence >= MIN_CONFIDENCE) {
        links.push({
          fromArchId: from.id,
          fromArchName: from.name,
          fromComponentId: comp.id,
          fromComponentLabel: comp.label,
          toArchId: bestArch.id,
          toArchName: bestArch.name,
          confidence: Math.round(bestMatch.confidence * 100) / 100,
          reason: bestMatch.reason,
        });
      }
    }
  }
  return links;
}

/** Index links by source architecture → (componentId → link). */
export function linksByComponent(links: CrossLink[], archId: string): Map<string, CrossLink> {
  const map = new Map<string, CrossLink>();
  for (const l of links) if (l.fromArchId === archId) map.set(l.fromComponentId, l);
  return map;
}

/** All architectures connected to `archId`, in either direction (for header chips / nav). */
export function neighborsOf(links: CrossLink[], archId: string): { archId: string; archName: string }[] {
  const seen = new Map<string, string>();
  for (const l of links) {
    if (l.fromArchId === archId) seen.set(l.toArchId, l.toArchName);
    if (l.toArchId === archId && !seen.has(l.fromArchId)) seen.set(l.fromArchId, l.fromArchName);
  }
  return [...seen.entries()].map(([id, name]) => ({ archId: id, archName: name }));
}
