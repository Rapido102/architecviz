// v1 — Intégrité : refs cassées, sécurité, drift cross-source.
// Pure : opère sur un objet ArchitectureConfig en mémoire, aucune dépendance fs/React.

import type { ArchitectureConfig, Component } from '../../types';
import type { Issue } from './report-types';
import { validationStatus } from '../status';

const SENSITIVE_RESOURCES = ['users', 'user', 'payments', 'payment', 'cards', 'card', 'personal_data', 'credentials', 'accounts', 'account'];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Indexes {
  componentById: Map<string, Component>;
  layerNames: Set<string>;
  backendEndpointsByKey: Map<string, { component_id: string; method: string; path: string }[]>;
  frontendApiCalls: { component_id: string; route_path: string; method: string; path: string }[];
}

function buildIndexes(arch: ArchitectureConfig): Indexes {
  const componentById = new Map<string, Component>();
  for (const c of arch.components ?? []) componentById.set(c.id, c);

  const layerNames = new Set<string>();
  for (const l of arch.layers ?? []) layerNames.add(l.name);

  const backendEndpointsByKey = new Map<string, { component_id: string; method: string; path: string }[]>();
  for (const c of arch.components ?? []) {
    if (c.type !== 'backend') continue;
    for (const e of c.endpoints ?? []) {
      const key = `${e.method.toUpperCase()} ${e.path}`;
      const arr = backendEndpointsByKey.get(key) ?? [];
      arr.push({ component_id: c.id, method: e.method, path: e.path });
      backendEndpointsByKey.set(key, arr);
    }
  }

  const frontendApiCalls: Indexes['frontendApiCalls'] = [];
  for (const c of arch.components ?? []) {
    if (c.type !== 'frontend') continue;
    for (const r of c.routes ?? []) {
      for (const call of r.api_calls ?? []) {
        const m = call.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)$/i);
        if (!m) continue;
        frontendApiCalls.push({ component_id: c.id, route_path: r.path, method: m[1].toUpperCase(), path: m[2] });
      }
    }
  }

  return { componentById, layerNames, backendEndpointsByKey, frontendApiCalls };
}

function checkBrokenRefs(arch: ArchitectureConfig, idx: Indexes): Issue[] {
  const issues: Issue[] = [];

  (arch.connections ?? []).forEach((conn, i) => {
    if (!idx.componentById.has(conn.from)) {
      issues.push({ severity: 'CRITICAL', category: 'broken_ref', message: `connections[${i}].from = "${conn.from}" : composant inexistant`, path: `$.connections[${i}].from`, component: conn.id ?? `${conn.from}_to_${conn.to}`, suggestion: `Créer le composant, corriger la référence, ou supprimer la connexion.` });
    }
    if (!idx.componentById.has(conn.to)) {
      issues.push({ severity: 'CRITICAL', category: 'broken_ref', message: `connections[${i}].to = "${conn.to}" : composant inexistant`, path: `$.connections[${i}].to`, component: conn.id ?? `${conn.from}_to_${conn.to}`, suggestion: `Créer le composant, corriger la référence, ou supprimer la connexion.` });
    }
  });

  (arch.components ?? []).forEach((c, i) => {
    if (!idx.layerNames.has(c.layer)) {
      issues.push({ severity: 'WARNING', category: 'broken_ref', message: `components[${i}].layer = "${c.layer}" : couche inexistante dans layers[]`, path: `$.components[${i}].layer`, component: c.id, suggestion: `Ajouter la couche "${c.layer}" dans layers[], ou corriger le layer du composant.` });
    }
  });

  (arch.components ?? []).forEach((c, ci) => {
    (c.endpoints ?? []).forEach((e, ei) => {
      (e.data_access ?? []).forEach((da, dai) => {
        if (!idx.componentById.has(da.component_id)) {
          issues.push({ severity: 'WARNING', category: 'broken_ref', message: `data_access pointe vers composant inexistant "${da.component_id}"`, path: `$.components[${ci}].endpoints[${ei}].data_access[${dai}].component_id`, component: c.id, suggestion: `Renommer (rename_component) ou ajouter le composant cible.` });
        }
      });
    });
  });

  (arch.connections ?? []).forEach((conn, ci) => {
    (conn.endpoint_mappings ?? []).forEach((m, mi) => {
      const targetComp = idx.componentById.get(conn.to);
      if (!targetComp || targetComp.type !== 'backend') return;
      const matches = (targetComp.endpoints ?? []).some((e) => e.method.toUpperCase() === m.method.toUpperCase() && e.path === m.backend_endpoint);
      if (!matches) {
        issues.push({ severity: 'WARNING', category: 'broken_ref', message: `endpoint_mapping pointe vers "${m.method} ${m.backend_endpoint}" mais cet endpoint n'existe pas dans ${conn.to}`, path: `$.connections[${ci}].endpoint_mappings[${mi}].backend_endpoint`, component: conn.id ?? `${conn.from}_to_${conn.to}`, suggestion: `Vérifier le path côté backend ou retirer le mapping orphelin.` });
      }
    });
  });

  (arch.components ?? []).forEach((c, ci) => {
    (c.used_by ?? []).forEach((consumerId, ui) => {
      if (!idx.componentById.has(consumerId)) {
        issues.push({ severity: 'WARNING', category: 'broken_ref', message: `used_by[${ui}] = "${consumerId}" : composant inexistant`, path: `$.components[${ci}].used_by[${ui}]`, component: c.id, suggestion: `Retirer ou corriger la référence.` });
      }
    });
  });

  const hasFrontend = (arch.components ?? []).some((c) => c.type === 'frontend');
  const hasBackend = (arch.components ?? []).some((c) => c.type === 'backend');
  if (arch.type === 'BACKEND' && hasFrontend) {
    issues.push({ severity: 'WARNING', category: 'broken_ref', message: `type=BACKEND alors qu'un composant frontend existe — devrait être FULLSTACK`, path: `$.type`, component: 'global', suggestion: `Renommer type en "FULLSTACK".` });
  }
  if (arch.type === 'FRONTEND' && hasBackend) {
    issues.push({ severity: 'WARNING', category: 'broken_ref', message: `type=FRONTEND alors qu'un composant backend existe — devrait être FULLSTACK`, path: `$.type`, component: 'global', suggestion: `Renommer type en "FULLSTACK".` });
  }

  const seen = new Map<string, number>();
  (arch.components ?? []).forEach((c, i) => {
    if (seen.has(c.id)) {
      issues.push({ severity: 'CRITICAL', category: 'broken_ref', message: `components[].id "${c.id}" en doublon (déjà vu à l'index ${seen.get(c.id)})`, path: `$.components[${i}].id`, component: c.id, suggestion: `consolidate_components ou rename_component.` });
    } else {
      seen.set(c.id, i);
    }
  });

  return issues;
}

function checkSecurity(arch: ArchitectureConfig): Issue[] {
  const issues: Issue[] = [];

  (arch.components ?? []).forEach((c, ci) => {
    if (c.type !== 'backend') return;

    (c.endpoints ?? []).forEach((e, ei) => {
      const method = e.method.toUpperCase();
      if (MUTATING_METHODS.has(method) && e.authenticated === false) {
        issues.push({ severity: 'CRITICAL', category: 'security', message: `Endpoint mutant ${method} ${e.path} : authenticated=false`, path: `$.components[${ci}].endpoints[${ei}].authenticated`, component: c.id, suggestion: `Vérifier que l'endpoint est intentionnellement public. Sinon ajouter l'auth.` });
      }
      const vs = validationStatus(e.validation);
      if (['POST', 'PUT', 'PATCH'].includes(method) && (vs === 'unverified' || vs === 'invalid')) {
        issues.push({ severity: 'WARNING', category: 'security', message: `Endpoint ${method} ${e.path} non validé (validation="${e.validation}")`, path: `$.components[${ci}].endpoints[${ei}].validation`, component: c.id, suggestion: `Ajouter @Valid / ValidationPipe / Pydantic sur le body, puis passer validation à VALID.` });
      }
      if (e.authenticated === false) {
        for (const da of e.data_access ?? []) {
          if (SENSITIVE_RESOURCES.some((s) => da.resource.toLowerCase().includes(s))) {
            issues.push({ severity: 'CRITICAL', category: 'security', message: `Endpoint public ${method} ${e.path} touche ressource sensible "${da.resource}" (${da.component_id})`, path: `$.components[${ci}].endpoints[${ei}].data_access`, component: c.id, suggestion: `Vérifier l'absence de fuite RGPD. Ajouter l'auth ou justifier.` });
          }
        }
      }
    });

    if (c.authentication && c.authentication.token_expiry === 'À confirmer') {
      issues.push({ severity: 'INFO', category: 'security', message: `Token expiry non documenté pour ${c.id}`, path: `$.components[${ci}].authentication.token_expiry`, component: c.id, suggestion: `Compléter (ex: "1h", "24h").` });
    }
  });

  (arch.connections ?? []).forEach((conn, ci) => {
    const protocol = (conn.protocol ?? '').toUpperCase();
    if (protocol === 'HTTP' || protocol === 'REST/HTTP') {
      issues.push({ severity: 'WARNING', category: 'security', message: `Connexion "${conn.id ?? `${conn.from}→${conn.to}`}" en HTTP non chiffré`, path: `$.connections[${ci}].protocol`, component: conn.id ?? `${conn.from}_to_${conn.to}`, suggestion: `Migrer vers HTTPS, ou marquer "interne seulement" dans note.` });
    }
    const target = arch.components?.find((c) => c.id === conn.to);
    if (target?.layer === 'External' && conn.authenticated === false && target.type !== 'iam') {
      issues.push({ severity: 'INFO', category: 'security', message: `Connexion vers tiers ${conn.to} sans authentification déclarée`, path: `$.connections[${ci}].authenticated`, component: conn.id ?? `${conn.from}_to_${conn.to}`, suggestion: `Confirmer que l'API tierce accepte des appels anonymes.` });
    }
  });

  return issues;
}

function checkDrift(arch: ArchitectureConfig, idx: Indexes): Issue[] {
  const issues: Issue[] = [];

  const referencedEndpoints = new Set<string>();
  for (const call of idx.frontendApiCalls) referencedEndpoints.add(`${call.method} ${call.path}`);
  for (const conn of arch.connections ?? []) {
    for (const m of conn.endpoint_mappings ?? []) referencedEndpoints.add(`${m.method.toUpperCase()} ${m.backend_endpoint}`);
  }

  (arch.components ?? []).forEach((c, ci) => {
    if (c.type !== 'backend') return;
    (c.endpoints ?? []).forEach((e, ei) => {
      const key = `${e.method.toUpperCase()} ${e.path}`;
      if (!referencedEndpoints.has(key) && !isInfraEndpoint(e.path)) {
        issues.push({ severity: 'INFO', category: 'drift', message: `Endpoint zombie : ${e.method} ${e.path} jamais appelé par un frontend ni présent dans un endpoint_mapping`, path: `$.components[${ci}].endpoints[${ei}]`, component: c.id, suggestion: `Vérifier l'usage, ou ajouter le mapping si appelé par un service interne.` });
      }
    });
  });

  for (const call of idx.frontendApiCalls) {
    const exact = idx.backendEndpointsByKey.get(`${call.method} ${call.path}`);
    if (exact && exact.length > 0) continue;
    const normalized = normalizePath(call.path);
    let matched = false;
    for (const [, eps] of idx.backendEndpointsByKey) {
      for (const ep of eps) {
        if (ep.method.toUpperCase() === call.method && normalizePath(ep.path) === normalized) { matched = true; break; }
      }
      if (matched) break;
    }
    if (!matched) {
      issues.push({ severity: 'WARNING', category: 'drift', message: `Frontend ${call.component_id} appelle ${call.method} ${call.path} (route ${call.route_path}) — aucun endpoint backend correspondant`, path: `$.components[?(@.id=='${call.component_id}')].routes`, component: call.component_id, suggestion: `Soit l'endpoint backend manque, soit l'appel pointe vers un service externe.` });
    }
  }

  (arch.components ?? []).forEach((c, ci) => {
    if (c.layer !== 'External') return;
    if (c.type === 'monitoring') return;
    const hasUsedBy = (c.used_by ?? []).length > 0;
    const hasIncoming = (arch.connections ?? []).some((conn) => conn.to === c.id);
    if (!hasUsedBy && !hasIncoming) {
      issues.push({ severity: 'INFO', category: 'drift', message: `Composant externe "${c.id}" sans used_by ni connexion entrante`, path: `$.components[${ci}]`, component: c.id, suggestion: `Ajouter used_by[], créer la connexion, ou supprimer si mort.` });
    }
  });

  const cacheKeysByComponent = new Map<string, Set<string>>();
  (arch.components ?? []).forEach((c) => {
    if (c.type !== 'cache') return;
    const keys = new Set<string>();
    for (const cd of c.cached_data ?? []) keys.add(cd.key_pattern);
    cacheKeysByComponent.set(c.id, keys);
  });
  const tablesByComponent = new Map<string, Set<string>>();
  (arch.components ?? []).forEach((c) => {
    if (c.type !== 'db') return;
    const t = new Set<string>();
    for (const tbl of c.tables ?? []) t.add(tbl.name);
    tablesByComponent.set(c.id, t);
  });

  (arch.components ?? []).forEach((c, ci) => {
    (c.endpoints ?? []).forEach((e, ei) => {
      (e.data_access ?? []).forEach((da, dai) => {
        if (tablesByComponent.has(da.component_id)) {
          const tables = tablesByComponent.get(da.component_id)!;
          const resource = da.resource.split('.').pop()?.replace(/[`"']/g, '') ?? da.resource;
          if (tables.size > 0 && !tables.has(resource)) {
            issues.push({ severity: 'INFO', category: 'drift', message: `data_access "${da.resource}" sur ${da.component_id} : table absente de tables[]`, path: `$.components[${ci}].endpoints[${ei}].data_access[${dai}]`, component: c.id, suggestion: `Ajouter la table à components[id=${da.component_id}].tables[] ou corriger.` });
          }
        }
        if (cacheKeysByComponent.has(da.component_id)) {
          const keys = cacheKeysByComponent.get(da.component_id)!;
          if (keys.size > 0 && !Array.from(keys).some((k) => matchesKeyPattern(k, da.resource))) {
            issues.push({ severity: 'INFO', category: 'drift', message: `data_access "${da.resource}" sur cache ${da.component_id} : key absente de cached_data[]`, path: `$.components[${ci}].endpoints[${ei}].data_access[${dai}]`, component: c.id, suggestion: `Documenter cette clé dans cached_data[].` });
          }
        }
      });
    });
  });

  (arch.components ?? []).forEach((c, ci) => {
    if (c.layer === 'External') return;
    const hasIn = (arch.connections ?? []).some((conn) => conn.to === c.id);
    const hasOut = (arch.connections ?? []).some((conn) => conn.from === c.id);
    if (!hasIn && !hasOut) {
      issues.push({ severity: 'INFO', category: 'drift', message: `Composant "${c.id}" isolé : aucune connexion entrante ni sortante`, path: `$.components[${ci}]`, component: c.id, suggestion: `Vérifier l'usage, ou supprimer.` });
    }
  });

  return issues;
}

function normalizePath(p: string): string {
  return p.replace(/\{[^}]+\}/g, ':p').replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, ':p').replace(/\/$/, '').toLowerCase();
}
function isInfraEndpoint(path: string): boolean {
  return /\/(health|actuator|metrics|status|ping|info)\b/i.test(path);
}
function matchesKeyPattern(pattern: string, resource: string): boolean {
  if (pattern === resource) return true;
  const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\{[^}]+\\\}/g, '.+') + '$');
  return regex.test(resource);
}

export function checkIntegrity(arch: ArchitectureConfig): Issue[] {
  const idx = buildIndexes(arch);
  return [...checkBrokenRefs(arch, idx), ...checkSecurity(arch), ...checkDrift(arch, idx)];
}
