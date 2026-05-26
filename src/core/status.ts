// Canonical status + provenance helpers. Pure, shared by the React app, the
// inspect core and the MCP server. Tolerant of legacy emoji/free-text values so
// existing architecture files keep working while new ones use the enum.

export type ValidationStatus = 'valid' | 'unverified' | 'invalid' | 'none';

/** Normalize a free-text / emoji `validation` value into a canonical status. */
export function validationStatus(v?: string | null): ValidationStatus {
  if (!v) return 'none';
  const s = v.toUpperCase();
  if (/❌|INVALID|\bKO\b/.test(s)) return 'invalid';
  if (/NON\s*VALID|NONVALID|⚠|UNVERIFIED|À\s*V[ÉE]RIFIER|A\s*VERIFIER|À\s*VALIDER|A\s*VALIDER|TODO/.test(s)) return 'unverified';
  if (/✅|\bVALID\b|\bOK\b|MAPP[ÉE]|MAPPED/.test(s)) return 'valid';
  return 'unverified';
}

export type MappingStatus = 'mapped' | 'check' | 'unmapped';

/** Normalize a connection endpoint_mapping `status` value. */
export function mappingStatus(v?: string | null): MappingStatus {
  if (!v) return 'unmapped';
  const s = v.toUpperCase();
  if (/⚠|V[ÉE]RIFIER|CHECK/.test(s)) return 'check';
  if (/✅|MAPP[ÉE]|MAPPED|OK/.test(s)) return 'mapped';
  return 'unmapped';
}

export const VALIDATION_META: Record<ValidationStatus, { emoji: string; label: string }> = {
  valid: { emoji: '✅', label: 'Validé' },
  unverified: { emoji: '⚠️', label: 'À valider' },
  invalid: { emoji: '❌', label: 'Invalide' },
  none: { emoji: '', label: '' },
};

/** Canonical enum string to store in the JSON (new extractions). */
export const VALIDATION_CANON: Record<Exclude<ValidationStatus, 'none'>, string> = {
  valid: 'VALID',
  unverified: 'UNVERIFIED',
  invalid: 'INVALID',
};

// ── Provenance ──────────────────────────────────────────────────────────────
// Who produced a piece of data: deterministic extractor, LLM pass, or a human.
export type Provenance = 'auto' | 'llm' | 'manual';

export const PROVENANCE_META: Record<Provenance, { label: string; short: string }> = {
  auto: { label: 'Extrait automatiquement', short: 'AUTO' },
  llm: { label: 'Complété par LLM (à vérifier)', short: 'LLM' },
  manual: { label: 'Saisi / confirmé manuellement', short: 'MANUEL' },
};

export type Criticality = 'low' | 'medium' | 'high' | 'critical';
