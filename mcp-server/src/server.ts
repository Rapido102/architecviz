#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { getSection } from './manifest-loader.js';
import { PROMPTS_DIR } from './paths.js';
import { stageFragment, listStaged, readStagedEntry } from './staging.js';
import { validateFragment } from './validation.js';
import { mergeFragmentIntoArchitecture } from './merge.js';
import { loadArchitectureState } from './architecture-state.js';
import { deriveConnections } from './derive/connections.js';
import { inspectArchitecture } from './inspect/index.js';
import { autoscan } from './autoscan/index.js';
import { enrichmentPlan } from './enrich/plan.js';
import { loadOrCreateArchitecture, writeArchitecture, targetFilePath } from './architecture-io.js';
import { renameComponent } from './ops/rename.js';
import { cleanArchitecture } from './ops/clean.js';
import { consolidateComponents } from './ops/consolidate.js';
import { deriveCrossLinks } from './ops/derive-cross-links.js';

const server = new McpServer({
  name: 'architectviz',
  version: '0.1.0',
});

const textResult = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
});

// ── get_section_prompt ──────────────────────────────────────────────────────
server.tool(
  'get_section_prompt',
  'Renvoie le préambule commun + le prompt compact pour la section donnée.',
  {
    section_id: z.string().describe('Identifiant de la section (ex: "identity", "components_backend")'),
  },
  async ({ section_id }) => {
    const section = getSection(section_id);
    const ref = section.ai_prompt_ref;
    if (!ref) {
      return textResult({ error: `Section "${section_id}" n'a pas d'ai_prompt_ref` });
    }
    const promptFile = ref.split('#')[0].replace(/^prompts\/sections\//, '');
    const fullPath = resolve(PROMPTS_DIR, promptFile);
    const commonPath = resolve(PROMPTS_DIR, '_common.md');
    if (!existsSync(fullPath)) {
      return textResult({ error: `Fichier introuvable : ${fullPath}` });
    }
    const common = existsSync(commonPath) ? readFileSync(commonPath, 'utf8') : '';
    const sectionPrompt = readFileSync(fullPath, 'utf8');
    return textResult({
      section_id,
      ai_prompt_ref: ref,
      content: `${common}\n\n---\n\n${sectionPrompt}`,
    });
  },
);

// ── autoscan ────────────────────────────────────────────────────────────────
server.tool(
  'autoscan',
  'Analyse la nature du projet (frontend/backend, stack, auth, db/cache/mq, feign…) et lance automatiquement les extracteurs adaptés, en stageant tous les squelettes détectés sous arch_name. NE fait PAS finalize (scanne plusieurs projets avec le même arch_name, puis finalize une fois). Préserve une identité déjà stagée et vise FULLSTACK si front+back coexistent. Les champs sémantiques (endpoints détaillés, data_access, cached_data, tables, api_calls) restent à compléter via une passe LLM.',
  {
    project_path: z.string().describe('Chemin absolu de la racine du projet à analyser (le workspace courant)'),
    arch_name: z.string().describe('Nom de l\'architecture — identique pour tous les projets du même SI'),
    project_key: z.string().optional().describe('Clé du projet pour le staging multi-projet (défaut : nom du dossier). Les composants sont stagés par projet pour ne pas s\'écraser entre microservices.'),
    dry_run: z.boolean().optional().default(false).describe('Si true, renvoie ce qui serait détecté/stagé sans écrire'),
  },
  async ({ project_path, arch_name, project_key, dry_run }) => textResult(autoscan(project_path, arch_name, { dry_run, project_key })),
);

// ── enrichment_plan ─────────────────────────────────────────────────────────
server.tool(
  'enrichment_plan',
  'Lit le staging (squelette autoscan) + le fichier mergé et renvoie un bon de travail ordonné pour combler les champs sémantiques manquants : endpoints détaillés, data_access, routes[].api_calls, tables[], cached_data[], descriptions, authentication. Chaque tâche indique la priorité, les fichiers à lire (files_hint), le prompt à appliquer, l\'action et le critère "done_when", + le project_key cible pour re-stager. Le tool ne remplit rien — il guide la passe LLM. À lancer entre autoscan et finalize.',
  {
    arch_name: z.string().describe('Nom de l\'architecture déjà scannée (autoscan/stage)'),
  },
  async ({ arch_name }) => textResult(enrichmentPlan(arch_name)),
);

// ── stage_fragment ──────────────────────────────────────────────────────────
server.tool(
  'stage_fragment',
  'Écrit un fragment validé dans le staging. Sections singleton (identity, layers, connections, flow_summary_and_warnings) → <arch>/<section>.json. Sections composants (components_*) avec project_key → <arch>/projects/<project_key>/<section>.json (multi-projet : plusieurs backends/microservices ne s\'écrasent pas).',
  {
    section_id: z.string(),
    fragment: z.unknown(),
    arch_name: z.string().describe('Nom court de l\'architecture (ex: "cegec", "my-api")'),
    project_key: z.string().optional().describe('Pour les sections components_* : isole le fragment par projet source. Ignoré pour les sections singleton.'),
  },
  async ({ section_id, fragment, arch_name, project_key }) => {
    const issues = validateFragment(section_id, fragment);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      return textResult({
        status: 'rejected',
        reason: 'Validation errors — fragment non écrit',
        errors,
      });
    }
    const { path, bytes } = stageFragment(arch_name, section_id, fragment, project_key);
    return textResult({ status: 'staged', path, bytes, warnings: issues });
  },
);

// ── list_staged ─────────────────────────────────────────────────────────────
server.tool(
  'list_staged',
  'Liste les fragments en attente de merge pour une architecture donnée.',
  {
    arch_name: z.string(),
  },
  async ({ arch_name }) => textResult(listStaged(arch_name)),
);

// ── inspect_architecture ────────────────────────────────────────────────────
server.tool(
  'inspect_architecture',
  'Audit complet du fichier final src/architectures/<arch_name>.json : intégrité structurelle (refs cassées, sécurité, drift cross-source) + score de complétude + data lineage (tables mortes, hot tables, chatty endpoints, mutations non authentifiées). Mode query optionnel pour interroger le lineage : what_touches_table:<name>, endpoints_calling:<component_id>, touches_for_endpoint:<METHOD>:<path>, dead_tables, hot_tables, chatty_endpoints, unauthenticated_mutations, components_isolated, help.',
  {
    arch_name: z.string().describe('Nom de l\'architecture (ex: "cegec")'),
    query: z.string().optional().describe('Optionnel — query targetée. Ex: "what_touches_table:users", "endpoints_calling:db_postgres", "help" pour la liste.'),
  },
  async ({ arch_name, query }) => {
    const report = inspectArchitecture(arch_name, { query });
    return textResult(report);
  },
);

// ── derive_connections ──────────────────────────────────────────────────────
server.tool(
  'derive_connections',
  'Dérive les connexions cross-projet en matchant les api_calls du frontend contre les endpoints du backend (et backend → external via used_by). Lit l\'état courant (fichier mergé + overlay staging) et stage le résultat dans .architectviz/staging/<arch_name>/connections.json. À exécuter une fois que components_frontend ET components_backend sont stagés ou mergés.',
  {
    arch_name: z.string().describe('Nom de l\'architecture (doit avoir des composants frontend et/ou backend déjà stagés/mergés)'),
    dry_run: z.boolean().optional().default(false).describe('Si true, renvoie le résultat sans stager le fragment'),
  },
  async ({ arch_name, dry_run }) => {
    const state = loadArchitectureState(arch_name);
    if (state.components.length === 0) {
      return textResult({
        status: 'no_components',
        message: `Aucun composant trouvé pour "${arch_name}". Lance d\'abord extract_components_frontend / extract_components_backend + stage_fragment.`,
        arch_name,
      });
    }

    const result = deriveConnections(state.components);

    if (result.connections.length === 0) {
      return textResult({
        status: 'no_matches',
        message:
          'Aucune connexion dérivable. Vérifie que les routes[].api_calls (frontend) et endpoints[] (backend) sont remplis, ou que les composants externes ont un used_by.',
        source: state.source,
        summary: result.summary,
      });
    }

    if (dry_run) {
      return textResult({
        status: 'dry-run',
        source: state.source,
        summary: result.summary,
        connections: result.connections,
      });
    }

    const { path } = stageFragment(arch_name, 'connections', result.connections);
    return textResult({
      status: 'staged',
      fragment_path: path,
      source: state.source,
      summary: result.summary,
      note:
        'Pour fusionner dans le fichier final : merge_staged({ arch_name, section_id: "connections" }). Attention : si tu avais des endpoint_mappings[].purpose rédigés à la main, ils seront écrasés — édite après merge plutôt qu\'avant.',
    });
  },
);

// ── finalize ────────────────────────────────────────────────────────────────
server.tool(
  'finalize',
  'Combo : derive_connections puis merge_staged. À appeler en fin de workflow, une fois tous les composants stagés (frontend + backend + data + external). Idempotent — relancer ne crée pas de doublons.',
  {
    arch_name: z.string(),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ arch_name, dry_run }) => {
    // 1. Try to derive connections (silent skip if no components or no matches)
    const state = loadArchitectureState(arch_name);
    let deriveSummary: unknown = null;
    let connectionsStagedPath: string | null = null;

    if (state.components.length > 0) {
      const result = deriveConnections(state.components);
      deriveSummary = result.summary;
      if (result.connections.length > 0 && !dry_run) {
        const { path } = stageFragment(arch_name, 'connections', result.connections);
        connectionsStagedPath = path;
      }
    }

    // 2. Merge all staged fragments
    const { arch: base } = loadOrCreateArchitecture(arch_name);
    const file = targetFilePath(arch_name);

    const staged = listStaged(arch_name);
    const mergeResults = staged.map((s) => {
      const fragment = readStagedEntry(s);
      const r = mergeFragmentIntoArchitecture(base, s.section_id, fragment);
      return { ...r, project_key: s.project_key };
    });

    if (!dry_run && staged.length > 0) {
      writeArchitecture(arch_name, base);
    }

    return textResult({
      status: dry_run ? 'dry-run' : 'finalized',
      arch_name,
      derive: {
        components_found: state.components.length,
        connections_staged_path: connectionsStagedPath,
        summary: deriveSummary,
      },
      merge: {
        target_file: file,
        fragments_merged: staged.length,
        sections: mergeResults,
      },
    });
  },
);

// ── merge_staged ────────────────────────────────────────────────────────────
server.tool(
  'merge_staged',
  'Fusionne les fragments stagés dans src/architectures/<arch_name>.json en appliquant les règles merge.identity du manifeste. Crée le fichier s\'il n\'existe pas.',
  {
    arch_name: z.string(),
    section_id: z.string().optional().describe('Optionnel — ne fusionner qu\'une section spécifique'),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ arch_name, section_id, dry_run }) => {
    const { arch: base } = loadOrCreateArchitecture(arch_name);
    const targetFile = targetFilePath(arch_name);

    const staged = listStaged(arch_name);
    const toMerge = section_id ? staged.filter((s) => s.section_id === section_id) : staged;
    if (toMerge.length === 0) {
      return textResult({ status: 'empty', message: 'Aucun fragment stagé à fusionner', staged });
    }

    const results = toMerge.map((s) => {
      const fragment = readStagedEntry(s);
      const r = mergeFragmentIntoArchitecture(base, s.section_id, fragment);
      return { ...r, project_key: s.project_key };
    });

    if (!dry_run) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(targetFile, JSON.stringify(base, null, 2) + '\n', 'utf8');
    }

    return textResult({
      status: dry_run ? 'dry-run' : 'merged',
      target_file: targetFile,
      sections_merged: results,
    });
  },
);

// ── rename_component ────────────────────────────────────────────────────────
server.tool(
  'rename_component',
  'Renomme un composant partout dans l\'architecture : components[].id, connections[].from/to, connections[].id (régénéré si convention `<from>_to_<to>`), components[].used_by[], endpoints[].data_access[].component_id, warnings[].component. Refuse si new_id existe déjà (utiliser consolidate dans ce cas).',
  {
    arch_name: z.string(),
    old_id: z.string().describe('Identifiant actuel du composant'),
    new_id: z.string().describe('Nouvel identifiant (snake_case, [a-z0-9_-]+)'),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ arch_name, old_id, new_id, dry_run }) => {
    const { arch, existed } = loadOrCreateArchitecture(arch_name);
    if (!existed) {
      return textResult({ status: 'no_file', message: `Fichier ${targetFilePath(arch_name)} n'existe pas.` });
    }
    const result = renameComponent(arch, old_id, new_id);
    if (!result.ok) {
      return textResult({ status: 'rejected', reason: result.reason, changes: result.changes });
    }
    if (!dry_run) writeArchitecture(arch_name, arch);
    return textResult({
      status: dry_run ? 'dry-run' : 'renamed',
      arch_name,
      old_id,
      new_id,
      changes: result.changes,
    });
  },
);

// ── consolidate_components ──────────────────────────────────────────────────
server.tool(
  'consolidate_components',
  'Fusionne plusieurs composants doublons en un seul (N→1) : union des champs (scalaires manquants comblés, arrays endpoints/routes/cached_data/tables/used_by/key_dependencies dédupliqués, authentication/deployment complétés), redirection de TOUTES les références (connections.from/to, used_by, data_access.component_id, warnings.component), suppression des composants absorbés, dédup des connexions. target_id peut être un id existant (un des sources ou un autre composant) ou un nouvel id.',
  {
    arch_name: z.string(),
    source_ids: z.array(z.string()).describe('IDs des composants à fusionner (les doublons)'),
    target_id: z.string().describe('ID résultant (survivant). Peut être un des source_ids, un composant existant, ou un nouvel id.'),
    dry_run: z.boolean().optional().default(false),
  },
  async ({ arch_name, source_ids, target_id, dry_run }) => {
    const { arch, existed } = loadOrCreateArchitecture(arch_name);
    if (!existed) {
      return textResult({ status: 'no_file', message: `Fichier ${targetFilePath(arch_name)} n'existe pas.` });
    }
    const result = consolidateComponents(arch, source_ids, target_id);
    if (!result.ok) {
      return textResult({ status: 'rejected', reason: result.reason });
    }
    if (!dry_run) writeArchitecture(arch_name, arch);
    return textResult({
      status: dry_run ? 'dry-run' : 'consolidated',
      arch_name,
      target: result.target,
      absorbed: result.absorbed,
      changes: result.changes,
    });
  },
);

// ── clean_architecture ──────────────────────────────────────────────────────
server.tool(
  'clean_architecture',
  'Applique des nettoyages safe et idempotents : suppression des connexions orphelines (from/to inexistants), des used_by[] orphelins, des data_access[] orphelins, des warnings orphelins ; dédup des composants par id, des endpoints par (method, path), des connexions par (from, to, protocol) ; ajout des layers manquantes référencées par des composants ; option fix_type_global pour corriger type=BACKEND→FULLSTACK en présence de frontend ; recalcule aussi flow_summary (technologies_count, backend_endpoints, frontend_routes, external_services). dry_run par défaut.',
  {
    arch_name: z.string(),
    dry_run: z.boolean().optional().default(true).describe('Par défaut true — passer false pour écrire le fichier.'),
    fix_type_global: z.boolean().optional().default(false).describe('Si true, corrige type=BACKEND/FRONTEND en FULLSTACK quand FE+BE coexistent.'),
  },
  async ({ arch_name, dry_run, fix_type_global }) => {
    const { arch, existed } = loadOrCreateArchitecture(arch_name);
    if (!existed) {
      return textResult({ status: 'no_file', message: `Fichier ${targetFilePath(arch_name)} n'existe pas.` });
    }
    const result = cleanArchitecture(arch, { fixTypeGlobal: fix_type_global });
    if (!dry_run) writeArchitecture(arch_name, arch);
    return textResult({
      status: dry_run ? 'dry-run' : 'cleaned',
      arch_name,
      target_file: targetFilePath(arch_name),
      changes: result.changes,
    });
  },
);

// ── derive_cross_links ────────────────────────────────────────────────────────
server.tool(
  'derive_cross_links',
  "Lit toutes les architectures de src/architectures/*.json, résout les liens inter-architectures (un composant d'une stack qui EST une autre stack cartographiée) et propose/écrit les external_ref canoniques. Sans arch_name : audit global (dry-run, aucun écriture). Avec arch_name + write=true : pose external_ref sur les composants de cette architecture pour les liens de confiance >= min_confidence (action 'set'), en préservant les références déjà posées ('already') et en signalant les conflits ('conflict'). Rend la liaison déterministe et auditable au lieu d'heuristique côté app.",
  {
    arch_name: z.string().optional().describe("Limiter aux liens partant de cette architecture (et autoriser l'écriture)."),
    write: z.boolean().optional().default(false).describe('Si true (et arch_name fourni), écrit les external_ref dans le fichier.'),
    min_confidence: z.number().optional().default(0.8).describe('Seuil de confiance pour écrire automatiquement (0..1).'),
  },
  async ({ arch_name, write, min_confidence }) => textResult(deriveCrossLinks({ arch_name, write, min_confidence })),
);

// ── Boot ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
