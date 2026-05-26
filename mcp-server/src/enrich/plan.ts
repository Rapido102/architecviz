// enrichment_plan : lit l'état stagé (squelette autoscan) + le fichier mergé,
// identifie les champs sémantiques manquants, et émet un bon de travail ordonné
// que Claude exécute (lecture du code + stage_fragment), avant finalize.
//
// Le tool ne remplit rien lui-même — il guide la passe LLM pour qu'elle soit
// fiable et exhaustive (rien d'oublié). Réutilise le scoring de core/inspect.

import { readFileSync, existsSync } from 'node:fs';
import { ARCHITECTURES_DIR } from '../paths.js';
import { resolve } from 'node:path';
import { listStaged, readStagedEntry } from '../staging.js';
import { computeCompleteness } from '../core/inspect/completeness.js';
import type { ArchitectureConfig } from '../types.js';

const MISSING = 'À confirmer';

interface ComponentLike {
  id: string;
  type?: string;
  layer?: string;
  technology?: string;
  description?: string;
  endpoints?: { path: string; method: string; description?: string; data_access?: unknown[]; authenticated?: boolean }[];
  routes?: { path: string; api_calls?: string[]; description?: string }[];
  tables?: unknown[];
  cached_data?: unknown[];
  authentication?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AssembledComponent {
  component: ComponentLike;
  project_key: string | null;
  section_id: string;
}

export interface EnrichmentTask {
  priority: 1 | 2 | 3;
  section: string;
  component_id?: string;
  project_key: string | null;
  gap: string;
  files_hint: string[];
  prompt_ref: string;
  action: string;
  done_when: string;
}

export interface EnrichmentPlan {
  arch_name: string;
  completeness_before: number;
  task_count: number;
  tasks: EnrichmentTask[];
  how_to_apply: string;
}

function sectionForComponent(c: ComponentLike): string {
  if (c.type === 'frontend') return 'components_frontend';
  if (c.type === 'backend') return 'components_backend';
  if (c.layer === 'External' || ['iam', 'third-party', 'monitoring', 'service'].includes(c.type ?? '')) return 'components_external';
  return 'components_data';
}

function filesHint(c: ComponentLike): string[] {
  const tech = (c.technology ?? '').toLowerCase();
  if (c.type === 'frontend') return ['src/**/*Routes*.{ts,tsx}', 'src/router/**/*', 'pages/**', 'app/**/page.*'];
  if (c.type === 'backend') {
    if (/spring|java|jersey/.test(tech)) return ['src/main/java/**/*Controller*.java', '**/*Resource*.java', '**/*Service*.java', '**/*Repository*.java'];
    if (/nest/.test(tech)) return ['src/**/*.controller.ts', 'src/**/*.service.ts'];
    if (/express|fastify|hono/.test(tech)) return ['src/**/*.{ts,js}', 'routes/**'];
    if (/fastapi|django|flask/.test(tech)) return ['**/*.py'];
    return ['src/**/*'];
  }
  return [];
}

function assemble(archName: string): { components: AssembledComponent[]; arch: ArchitectureConfig } {
  const byId = new Map<string, AssembledComponent>();

  // 1. merged file (project_key = null)
  const file = resolve(ARCHITECTURES_DIR, `${archName}.json`);
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { components?: ComponentLike[] };
      for (const c of data.components ?? []) byId.set(c.id, { component: c, project_key: null, section_id: sectionForComponent(c) });
    } catch { /* ignore */ }
  }

  // 2. staged component fragments (staged wins, track project_key)
  for (const entry of listStaged(archName)) {
    if (!entry.section_id.startsWith('components_')) continue;
    const frag = readStagedEntry(entry);
    if (!Array.isArray(frag)) continue;
    for (const c of frag as ComponentLike[]) {
      const existing = byId.get(c.id);
      byId.set(c.id, {
        component: { ...(existing?.component ?? {}), ...c },
        project_key: entry.project_key,
        section_id: entry.section_id,
      });
    }
  }

  const components = [...byId.values()];
  const arch = { components: components.map((a) => a.component) } as unknown as ArchitectureConfig;
  return { components, arch };
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === MISSING;
}

export function enrichmentPlan(archName: string): EnrichmentPlan {
  const { components, arch } = assemble(archName);
  const tasks: EnrichmentTask[] = [];

  for (const { component: c, project_key, section_id } of components) {
    const hints = filesHint(c);

    if (c.type === 'backend') {
      // P1 — endpoints
      if (!c.endpoints || c.endpoints.length === 0) {
        tasks.push({
          priority: 1, section: section_id, component_id: c.id, project_key,
          gap: `endpoints vide sur ${c.id}`,
          files_hint: hints,
          prompt_ref: 'prompts/sections/components-backend.md#endpoints',
          action: `Lire les controllers, extraire chaque endpoint (method, path complet, params, authenticated, response_schema), compléter le composant ${c.id} et re-stager la section ${section_id} (project_key="${project_key ?? ''}") avec le tableau complet.`,
          done_when: `${c.id}.endpoints.length >= 1`,
        });
      } else {
        // P1 — data_access par endpoint
        const without = c.endpoints.filter((e) => !e.data_access || e.data_access.length === 0);
        if (without.length > 0) {
          tasks.push({
            priority: 1, section: section_id, component_id: c.id, project_key,
            gap: `data_access vide sur ${without.length}/${c.endpoints.length} endpoints de ${c.id}`,
            files_hint: hints,
            prompt_ref: 'prompts/sections/components-backend.md#data_access',
            action: `Tracer Controller→Service→Repository pour chaque endpoint, remplir data_access[] (component_id cible, resource = table/clé/topic, operation), puis re-stager ${section_id} (project_key="${project_key ?? ''}").`,
            done_when: `chaque endpoint de ${c.id} a data_access (sauf endpoints triviaux type /health)`,
          });
        }
        // P3 — descriptions d'endpoints
        const noDesc = c.endpoints.filter((e) => isMissing(e.description));
        if (noDesc.length > 0) {
          tasks.push({
            priority: 3, section: section_id, component_id: c.id, project_key,
            gap: `${noDesc.length} endpoint(s) sans description sur ${c.id}`,
            files_hint: hints,
            prompt_ref: 'prompts/sections/components-backend.md#endpoints',
            action: `Ajouter une description fonctionnelle (1 ligne) par endpoint, puis re-stager ${section_id}.`,
            done_when: `tous les endpoints de ${c.id} ont une description`,
          });
        }
      }
      // P3 — authentication
      if (c.authentication && Object.values(c.authentication).some((v) => v === MISSING)) {
        tasks.push({
          priority: 3, section: section_id, component_id: c.id, project_key,
          gap: `authentication incomplète sur ${c.id}`,
          files_hint: ['**/*Security*.java', '**/SecurityConfig*', 'application*.yml'],
          prompt_ref: 'prompts/sections/components-backend.md#authentication',
          action: `Lire la config de sécurité, compléter authentication (type, provider, token_format, token_expiry, roles_permissions), puis re-stager ${section_id}.`,
          done_when: `authentication de ${c.id} sans "À confirmer"`,
        });
      }
    }

    if (c.type === 'frontend') {
      if (!c.routes || c.routes.length === 0) {
        tasks.push({
          priority: 2, section: section_id, component_id: c.id, project_key,
          gap: `routes vide sur ${c.id}`,
          files_hint: hints,
          prompt_ref: 'prompts/sections/components-frontend.md#routes',
          action: `Extraire les routes (path, label, authenticated), puis re-stager ${section_id} (project_key="${project_key ?? ''}").`,
          done_when: `${c.id}.routes.length >= 1`,
        });
      } else {
        const without = c.routes.filter((r) => !r.api_calls || r.api_calls.length === 0);
        if (without.length > 0) {
          tasks.push({
            priority: 1, section: section_id, component_id: c.id, project_key,
            gap: `api_calls vide sur ${without.length}/${c.routes.length} routes de ${c.id} (bloque derive_connections)`,
            files_hint: hints,
            prompt_ref: 'prompts/sections/components-frontend.md#routes',
            action: `Pour chaque route, suivre le composant racine et lister les appels HTTP (fetch/axios/useQuery) au format "METHOD /path" dans api_calls, puis re-stager ${section_id}.`,
            done_when: `chaque route applicative de ${c.id} a au moins un api_call (hors pages purement statiques)`,
          });
        }
      }
    }

    if (c.type === 'db') {
      if (!c.tables || c.tables.length === 0) {
        tasks.push({
          priority: 2, section: section_id, component_id: c.id, project_key,
          gap: `tables vide sur ${c.id}`,
          files_hint: ['**/*Entity*.java', 'prisma/schema.prisma', 'src/main/resources/db/migration/*.sql', '**/*.entity.ts'],
          prompt_ref: 'prompts/sections/components-data.md#tables',
          action: `Lister les tables (@Entity/@Table, schema.prisma, migrations) avec leur purpose, puis re-stager ${section_id} (project_key="${project_key ?? ''}").`,
          done_when: `${c.id}.tables peuplé (ou confirmé vide si DB sans schéma propre)`,
        });
      }
    }

    if (c.type === 'cache') {
      if (!c.cached_data || c.cached_data.length === 0) {
        tasks.push({
          priority: 2, section: section_id, component_id: c.id, project_key,
          gap: `cached_data vide sur ${c.id}`,
          files_hint: ['**/*.java', '**/*.ts'],
          prompt_ref: 'prompts/sections/components-data.md',
          action: `Repérer les @Cacheable / clés Redis utilisées (key_pattern, ttl, purpose), puis re-stager ${section_id} (project_key="${project_key ?? ''}").`,
          done_when: `${c.id}.cached_data peuplé`,
        });
      }
    }

    // P3 — description composant (toutes natures)
    if (isMissing(c.description)) {
      tasks.push({
        priority: 3, section: section_id, component_id: c.id, project_key,
        gap: `description métier manquante sur ${c.id}`,
        files_hint: ['README.md'],
        prompt_ref: section_id === 'components_frontend' ? 'prompts/sections/components-frontend.md' : 'prompts/sections/components-backend.md',
        action: `Rédiger une description métier (1-2 phrases) pour ${c.id}, puis re-stager ${section_id}.`,
        done_when: `${c.id}.description non vide`,
      });
    }
  }

  tasks.sort((a, b) => a.priority - b.priority);

  const completeness = computeCompleteness(arch);

  return {
    arch_name: archName,
    completeness_before: completeness.overall_score,
    task_count: tasks.length,
    tasks,
    how_to_apply:
      'Traite les tâches par priorité (1 → 3). Pour chaque tâche : lis les files_hint, applique le prompt_ref, complète le(s) composant(s), puis re-stage la section avec stage_fragment(section_id, fragment_complet, arch_name, project_key). Quand le plan est vide ou que les tâches P1 sont faites, lance finalize(arch_name).',
  };
}
