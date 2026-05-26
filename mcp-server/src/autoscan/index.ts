// autoscan / autoscan_many : détecte la nature du projet, lance les extracteurs
// adaptés et stage les squelettes. N'enchaîne PAS finalize (multi-projet → l'utilisateur
// finalise une fois tous les projets scannés). Préserve l'identité déjà stagée (vise FULLSTACK).

import { extractIdentity } from '../extractors/identity.js';
import { extractFrontendComponents } from '../extractors/components-frontend.js';
import { extractBackendComponents } from '../extractors/components-backend.js';
import type { ExtractionCoverage, DataAccessCandidate } from '../extractors/endpoints.js';
import { extractDataComponents } from '../extractors/components-data.js';
import { extractExternalComponents } from '../extractors/components-external.js';
import { stageFragment, listStaged, readStaged } from '../staging.js';
import { validateFragment } from '../validation.js';
import { basename } from 'node:path';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
}

type ArchType = 'FRONTEND' | 'BACKEND' | 'FULLSTACK' | 'OTHER';

interface StagedSection {
  section_id: string;
  status: 'staged' | 'skipped' | 'rejected';
  reason?: string;
  count?: number;
}

export interface AutoscanResult {
  arch_name: string;
  project_path: string;
  project_key: string;
  profile: {
    kinds: string[];
    type_this_project: ArchType;
    identity_type_after: ArchType;
    signals: {
      frontend: boolean;
      backend: boolean;
      data: string[];
      external: string[];
      auth: boolean;
    };
  };
  staged: StagedSection[];
  coverage?: ExtractionCoverage;
  data_access_candidates?: DataAccessCandidate[];
  completion_needed: string[];
  next_step: string;
}

function reconcileType(existing: string | undefined, current: ArchType): ArchType {
  const norm = (t?: string): ArchType | null =>
    t === 'FRONTEND' || t === 'BACKEND' || t === 'FULLSTACK' ? t : null;
  const set = new Set<ArchType>();
  const e = norm(existing);
  if (e) set.add(e);
  if (current !== 'OTHER') set.add(current);
  if (set.has('FULLSTACK')) return 'FULLSTACK';
  if (set.has('FRONTEND') && set.has('BACKEND')) return 'FULLSTACK';
  if (set.size === 1) return [...set][0];
  return current;
}

function stageChecked(archName: string, sectionId: string, fragment: unknown, projectKey?: string): StagedSection {
  const issues = validateFragment(sectionId, fragment);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    return { section_id: sectionId, status: 'rejected', reason: `${errors.length} erreur(s) de validation` };
  }
  stageFragment(archName, sectionId, fragment, projectKey);
  const count = Array.isArray(fragment) ? fragment.length : 1;
  return { section_id: sectionId, status: 'staged', count };
}

export function autoscan(projectPath: string, archName: string, options: { dry_run?: boolean; project_key?: string } = {}): AutoscanResult {
  const dryRun = options.dry_run ?? false;
  const projectKey = options.project_key ?? slugify(basename(projectPath.replace(/[/\\]+$/, '')));

  // 1. Run all extractors — each one's `detected` flag IS the nature detection.
  const frontend = extractFrontendComponents(projectPath);
  const backend = extractBackendComponents(projectPath);
  const hasFrontend = frontend.detected;
  const hasBackend = backend.detected;

  const backendId =
    (hasBackend && (backend.fragment[0]?.id as string)) || 'backend_api';

  const data = hasBackend ? extractDataComponents(projectPath) : { fragment: [], detected: false, notes: [] };
  const external = hasBackend ? extractExternalComponents(projectPath, backendId) : { fragment: [], detected: false, notes: [] };

  const auth = external.fragment.some((c) => (c as { type?: string }).type === 'iam');

  // 2. Determine this project's type
  const typeThisProject: ArchType = hasFrontend && hasBackend ? 'FULLSTACK' : hasFrontend ? 'FRONTEND' : hasBackend ? 'BACKEND' : 'OTHER';

  // 3. Identity reconciliation (don't overwrite a previously staged identity; aim FULLSTACK)
  const alreadyStaged = new Set(listStaged(archName).map((s) => s.section_id));
  const staged: StagedSection[] = [];

  let identityTypeAfter: ArchType;
  if (alreadyStaged.has('identity')) {
    const existing = readStaged(archName, 'identity') as Record<string, unknown>;
    const combined = reconcileType(existing.type as string, typeThisProject);
    identityTypeAfter = combined;
    if (combined !== existing.type) {
      existing.type = combined;
      if (!dryRun) stageFragment(archName, 'identity', existing);
      staged.push({ section_id: 'identity', status: 'staged', reason: `type → ${combined} (préservé, non écrasé)` });
    } else {
      staged.push({ section_id: 'identity', status: 'skipped', reason: 'identité déjà stagée (préservée)' });
    }
  } else {
    const id = extractIdentity(projectPath);
    const frag = { ...id.fragment, type: typeThisProject };
    identityTypeAfter = typeThisProject;
    staged.push(dryRun ? { section_id: 'identity', status: 'staged', count: 1 } : stageChecked(archName, 'identity', frag));
  }

  // 4. Stage component sections that detected something
  const sectionsToStage: { id: string; fragment: unknown[]; detected: boolean }[] = [
    { id: 'components_frontend', fragment: frontend.fragment, detected: hasFrontend },
    { id: 'components_backend', fragment: backend.fragment, detected: hasBackend },
    { id: 'components_data', fragment: data.fragment, detected: data.detected },
    { id: 'components_external', fragment: external.fragment, detected: external.detected },
  ];

  for (const s of sectionsToStage) {
    if (!s.detected) continue;
    if (dryRun) {
      staged.push({ section_id: s.id, status: 'staged', count: s.fragment.length, reason: `projet "${projectKey}"` });
    } else {
      staged.push({ ...stageChecked(archName, s.id, s.fragment, projectKey), reason: `projet "${projectKey}"` });
    }
  }

  // 5. Completion hints (what the deterministic skeleton can't fill)
  const completion: string[] = [];
  if (hasBackend) {
    const cov = backend.coverage;
    const cand = backend.data_access_candidates?.length ?? 0;
    completion.push(
      `components_backend : ${cov?.endpoints_extracted ?? 0} endpoint(s) extrait(s) auto — compléter description/params/response_fields + rattacher les ${cand} candidat(s) data_access (provenance=llm une fois confirmés). get_section_prompt components_backend`,
    );
  }
  if (hasFrontend) completion.push('components_frontend : routes[].api_calls + descriptions — lecture LLM (get_section_prompt components_frontend)');
  if (data.detected) completion.push('components_data : cached_data[] + tables[] — lecture LLM (get_section_prompt components_data)');

  return {
    arch_name: archName,
    project_path: projectPath,
    project_key: projectKey,
    profile: {
      kinds: [hasFrontend ? 'frontend' : null, hasBackend ? 'backend' : null].filter(Boolean) as string[],
      type_this_project: typeThisProject,
      identity_type_after: identityTypeAfter,
      signals: {
        frontend: hasFrontend,
        backend: hasBackend,
        data: data.fragment.map((c) => (c as { id: string }).id),
        external: external.fragment.map((c) => (c as { id: string }).id),
        auth,
      },
    },
    staged,
    coverage: backend.coverage,
    data_access_candidates: backend.data_access_candidates,
    completion_needed: completion,
    next_step:
      'Scanner les autres projets du même SI avec le même arch_name, puis : finalize(arch_name). ' +
      'Pour enrichir les champs sémantiques avant finalize, demander à Claude une passe de complétion (data_access, endpoints, api_calls).',
  };
}

// ── autoscan_many ─────────────────────────────────────────────────────────────

export interface AutoscanManyProjectInput {
  path: string;
  key?: string;
}

interface AutoscanManyProjectResult {
  project_path: string;
  project_key: string;
  status: 'ok' | 'error';
  result?: AutoscanResult;
  error?: string;
}

export interface AutoscanManyResult {
  arch_name: string;
  projects_scanned: number;
  results: AutoscanManyProjectResult[];
  summary: {
    total_endpoints: number;
    total_components: number;
    total_da_candidates: number;
    errors: number;
  };
  next_step: string;
}

export function autoscanMany(
  archName: string,
  projects: AutoscanManyProjectInput[],
  options: { dry_run?: boolean } = {},
): AutoscanManyResult {
  const results: AutoscanManyProjectResult[] = [];
  let totalEndpoints = 0;
  let totalComponents = 0;
  let totalDaCandidates = 0;
  let errors = 0;

  for (const proj of projects) {
    try {
      const res = autoscan(proj.path, archName, { dry_run: options.dry_run, project_key: proj.key });
      const endpointCount = res.coverage?.endpoints_extracted ?? 0;
      const componentCount = res.staged.filter((s) => s.status === 'staged').reduce((sum, s) => sum + (s.count ?? 0), 0);
      const daCount = res.data_access_candidates?.length ?? 0;
      totalEndpoints += endpointCount;
      totalComponents += componentCount;
      totalDaCandidates += daCount;
      results.push({ project_path: proj.path, project_key: res.project_key, status: 'ok', result: res });
    } catch (err) {
      errors++;
      const key = proj.key ?? slugify(proj.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'project');
      results.push({
        project_path: proj.path,
        project_key: key,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const successCount = results.filter((r) => r.status === 'ok').length;

  return {
    arch_name: archName,
    projects_scanned: projects.length,
    results,
    summary: {
      total_endpoints: totalEndpoints,
      total_components: totalComponents,
      total_da_candidates: totalDaCandidates,
      errors,
    },
    next_step:
      successCount > 0
        ? `${successCount} projet(s) stagé(s). Lancer enrichment_plan("${archName}") pour combler les champs sémantiques, puis finalize("${archName}").`
        : `Tous les projets ont échoué — vérifier les chemins. Aucun fragment stagé pour "${archName}".`,
  };
}
