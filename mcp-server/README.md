# architectviz-mcp — Guide d'utilisation

Serveur MCP pour ArchitectViz. Permet à Claude Code, Continue, Cursor (ou n'importe quel client compatible MCP) d'extraire une cartographie de SI **section par section** depuis un projet ouvert dans l'IDE, avec **fusion idempotente** dans `src/architectures/<arch>.json`.

## Principe

Le manifeste [`extraction-manifest.jsonc`](../extraction-manifest.jsonc) découpe le schéma ArchitectViz en 8 sections. Chaque section a :
- un **extracteur déterministe** (parse `package.json`, `pom.xml`, etc.) qui produit un squelette
- un **prompt compact** dans [`prompts/sections/`](../prompts/sections/) que l'IA utilise pour combler les champs flous
- des **règles de merge** (`identity`, `preserve-manual`) qui garantissent qu'un re-scan ne crée pas de doublon et ne perd pas le contenu rédigé à la main

Le serveur MCP expose des outils déterministes (parsers, validation, staging, merge). Le **LLM du client** (Claude) appelle ces outils, lit le prompt de section, et complète les champs marqués `"À confirmer"`.

## Installation

```powershell
cd mcp-server
npm install
npm run build
```

Vérification rapide :
```powershell
node dist/server.js
# Doit attendre sur stdin sans erreur. Ctrl+C pour quitter.
```

## Configuration client

### Claude Code

Créer `.mcp.json` à la racine du workspace (ou ajouter à `~/.claude/settings.json`) :
```json
{
  "mcpServers": {
    "architectviz": {
      "command": "node",
      "args": ["C:/Users/Dylan/Downloads/architectviz/mcp-server/dist/server.js"]
    }
  }
}
```

Redémarrer Claude Code. Vérifier que les outils apparaissent avec `/mcp`.

### Continue (VS Code / JetBrains)

Dans `~/.continue/config.json` :
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "node",
          "args": ["C:/Users/Dylan/Downloads/architectviz/mcp-server/dist/server.js"]
        }
      }
    ]
  }
}
```

### Cursor

Dans `~/.cursor/mcp.json` :
```json
{
  "mcpServers": {
    "architectviz": {
      "command": "node",
      "args": ["C:/Users/Dylan/Downloads/architectviz/mcp-server/dist/server.js"]
    }
  }
}
```

## Workflow utilisateur

### 1. Ouvrir le projet à cartographier dans l'IDE

Exemple : tu ouvres `C:/Users/Dylan/Downloads/cegec/cegec-api` dans VS Code avec Claude Code.

### 2. Demander une extraction par section

> *« Scan ce projet pour ArchitectViz, section identity puis components_backend. Nom court : `cegec-api`. »*

Claude va appeler dans l'ordre :
1. `extract_identity({ project_path: <workspace> })` → squelette `{architecture, version, lastUpdated, type: "À confirmer", description}`
2. `get_section_prompt({ section_id: "identity" })` → prompt compact + préambule
3. Lit éventuellement README/package.json pour reformuler `description` en métier
4. `validate_fragment({ section_id: "identity", fragment })` → vérifie type/enum/pattern
5. `stage_fragment({ section_id: "identity", fragment, arch_name: "cegec-api" })` → écrit `.architectviz/staging/cegec-api/identity.json`

Puis idem pour `components_backend`.

### 3. Relire les fragments stagés

```
.architectviz/staging/cegec-api/
├── identity.json
└── components_backend.json
```

Édite ces fichiers manuellement si besoin. Les valeurs encore à `"À confirmer"` te montrent ce qui n'a pas pu être déduit.

### 4. Fusionner

> *« Merge le staging ArchitectViz pour cegec-api. »*

Claude appelle :
- `list_staged({ arch_name: "cegec-api" })` → liste des fragments prêts
- `merge_staged({ arch_name: "cegec-api", dry_run: true })` → preview (pas d'écriture)
- `merge_staged({ arch_name: "cegec-api" })` → écrit `src/architectures/cegec-api.json`

Le merge applique automatiquement `merge.identity` du manifeste :
- `components` dédupliqués par `id`
- `endpoints` par `(method, path)`
- `routes` par `path`
- `connections` par `(from, to, protocol)`

Un re-scan ultérieur ne créera pas de doublon et préservera les champs rédigés à la main.

## Référence des outils

> **12 tools.** La couche d'extraction est désormais pilotée par `autoscan` : les extracteurs déterministes par section (`extract_identity`, `extract_components_frontend/backend/data/external`) ne sont plus exposés individuellement — `autoscan` les appelle en interne. `validate_fragment`, `list_sections` et `recompute_summary` ont aussi été retirés (validation intégrée à `stage_fragment` ; recompute intégré à `clean_architecture`).

### `get_section_prompt(section_id)`
Renvoie `_common.md` + le prompt compact de la section. À appeler avant de combler les champs flous (passe LLM d'enrichissement).

### `stage_fragment(section_id, fragment, arch_name, project_key?)`
- Valide d'abord (règles du manifeste). Si erreurs → rejeté, rien n'est écrit.
- Sections singleton → `<arch>/<section>.json` ; sections `components_*` avec `project_key` → `<arch>/projects/<project_key>/<section>.json` (multi-projet).

### `derive_connections(arch_name, dry_run?)`
Dérive de façon **déterministe** les connexions cross-projet :
- **Frontend → Backend** : match `routes[].api_calls` ↔ `endpoints[]` par `(method, path normalisé)` — `{id}` vs `:id` traités de manière équivalente. Status `✅ MAPPÉ` (exact) ou `⚠️ À VÉRIFIER` (matched après normalisation).
- **Backend → External** : reverse-lookup sur `components[external].used_by[]`.

Charge l'état courant (fichier mergé `src/architectures/<arch>.json` + overlay des sections `components_*` stagées non encore mergées). À exécuter une fois que **les deux côtés** (FE + BE) sont stagés ou mergés. Stage le résultat dans `.architectviz/staging/<arch_name>/connections.json`.

Sortie :
```jsonc
{
  "status": "staged",
  "fragment_path": "...",
  "summary": {
    "frontends": 1, "backends": 1, "externals": 2,
    "connections_derived": 3,
    "endpoint_mappings_total": 4,
    "matched_api_calls": 4,
    "unmatched_api_calls": [{ "call": "GET /api/v1/missing", "from_component": "frontend_react", "from_route": "/missing" }]
  }
}
```

Les `unmatched_api_calls` te disent immédiatement quels appels frontend n'ont pas de cible backend — soit l'endpoint backend manque, soit le path frontend est faux.

### `list_staged(arch_name)`
Liste les fragments présents pour une architecture.

### `inspect_architecture(arch_name, query?)`
Audit complet du fichier final `src/architectures/<arch_name>.json` (avec fallback sur le staging si pas encore mergé) :

**Mode rapport** (sans `query`) — retourne :
- **`integrity.issues[]`** : refs cassées (`connections.from/to`, `components.layer`, `data_access.component_id`, `endpoint_mappings`, `used_by`, IDs en doublon, type global incohérent), sécurité (endpoints mutants sans auth, sans `@Valid`, données sensibles publiques, tokens sans expiration, HTTP non chiffré vers tiers), drift (endpoints zombies, appels 404 potentiels, composants tiers orphelins, tables vs cached_data désalignés, composants isolés). Trois sévérités : `CRITICAL`, `WARNING`, `INFO`.
- **`completeness`** : score global 0-100 + breakdown (`endpoints_with_data_access_pct`, `routes_with_api_calls_pct`, `components_with_description_pct`, `components_with_precise_versions_pct`, `tables_with_purpose_pct`, comptage et échantillon des placeholders `"À confirmer"`).
- **`lineage`** : `dead_tables` (tables jamais touchées), `hot_tables` (touchées par > 3 endpoints), `chatty_endpoints` (> 5 data_access), `unauthenticated_endpoints_mutating`.

**Mode query** (avec `query`) — interrogation ciblée :
| Query | Renvoie |
|---|---|
| `help` | Liste des queries disponibles |
| `what_touches_table:<name>` | Endpoints qui touchent la table donnée (avec leur opération) |
| `endpoints_calling:<component_id>` | Endpoints qui appellent ce composant via `data_access` |
| `touches_for_endpoint:<METHOD>:<path>` | data_access complet d'un endpoint précis |
| `dead_tables` | Tables déclarées mais jamais touchées |
| `hot_tables` | Tables touchées par > 3 endpoints (candidats à un service dédié) |
| `chatty_endpoints` | Endpoints avec > 5 data_access (couplage fort) |
| `unauthenticated_mutations` | POST/PUT/DELETE avec `authenticated: false` |
| `components_isolated` | Composants sans connexion in/out (mort ou oublié) |

### `enrichment_plan(arch_name)`
Renvoie un **bon de travail ordonné** pour combler les champs sémantiques que le squelette d'`autoscan` ne remplit pas (endpoints détaillés, `data_access`, `routes[].api_calls`, `tables[]`, `cached_data[]`, descriptions, `authentication`). Ne remplit rien lui-même — guide la passe LLM. À lancer **entre `autoscan` et `finalize`**.

Chaque tâche : `priority` (1-3), `section`, `component_id`, `project_key` (slot où re-stager), `gap`, `files_hint` (où lire), `prompt_ref`, `action`, `done_when` (critère de complétude). Séquençage intelligent : la tâche `data_access` n'apparaît qu'une fois les `endpoints` remplis (re-lancer le plan après chaque vague). Réutilise le scoring de `core/inspect`.

```jsonc
{
  "completeness_before": 54,
  "task_count": 7,
  "tasks": [
    { "priority": 1, "section": "components_backend", "component_id": "backend_spring", "project_key": "cegec_api",
      "gap": "endpoints vide sur backend_spring",
      "files_hint": ["src/main/java/**/*Controller*.java", "**/*Service*.java"],
      "prompt_ref": "prompts/sections/components-backend.md#endpoints",
      "done_when": "backend_spring.endpoints.length >= 1" }
  ]
}
```

### `finalize(arch_name, dry_run?)`
Combo idempotent : `derive_connections` + `merge_staged`. À appeler en fin de workflow, une fois tous les composants stagés. Relancer ne crée pas de doublons (dédup par identity au merge). Skip silencieusement la dérivation s'il n'y a pas de composants ou pas de matches.

### `merge_staged(arch_name, section_id?, dry_run?)`
- Lit le fichier cible `src/architectures/<arch_name>.json` (crée un squelette si absent).
- Pour chaque fragment stagé : applique la stratégie de merge.
  - `identity` → `components` (merge dans `$.components` par `id`)
  - `flow_summary_and_warnings` → object-merge + dédup warnings par `(severity, message, component)`
  - Autres (`layers`, `connections`) → dédup par clés d'identité du manifeste
- Si `dry_run: true` → renvoie le résumé sans écrire.
- Sinon → écrit le fichier final.

### `autoscan(project_path, arch_name, project_key?, dry_run?)`
Point d'entrée d'extraction : détecte la nature du projet et lance les extracteurs adaptés, en stageant tous les squelettes (composants par projet). Préserve une identité déjà stagée (vise FULLSTACK). Ne fait pas finalize.

### Outils de maintenance (sur le fichier finalisé)

**`rename_component(arch_name, old_id, new_id, dry_run?)`** — renomme un composant partout (1→1) : `components[].id`, `connections.from/to` (+ id régénéré), `used_by[]`, `data_access[].component_id`, `warnings[].component`. Refuse si `new_id` existe.

**`consolidate_components(arch_name, source_ids[], target_id, dry_run?)`** — fusionne plusieurs doublons en un (N→1) : union des champs (scalaires manquants comblés, arrays endpoints/routes/cached_data/tables/used_by/key_dependencies dédupliqués, authentication/deployment complétés), redirection de toutes les références, suppression des absorbés, dédup des connexions. `target_id` peut être un source, un composant existant, ou un nouvel id.

**`clean_architecture(arch_name, dry_run?, fix_type_global?)`** — nettoyages idempotents : suppression des refs orphelines (connexions, used_by, data_access, warnings), dédup (composants/endpoints/connexions), ajout des layers manquantes, `fix_type_global` (BACKEND→FULLSTACK), et **recalcul du flow_summary** (recompute intégré). `dry_run` par défaut.

## Staging multi-projet (même arch_name)

Le staging sépare les sections selon leur nature :

```
.architectviz/staging/<arch_name>/
├── identity.json                      ← singleton (1 par SI)
├── layers.json                        ← singleton
├── connections.json                   ← singleton (dérivé)
├── flow_summary_and_warnings.json     ← singleton
└── projects/
    ├── <project_key_A>/
    │   ├── components_frontend.json
    │   └── ...
    └── <project_key_B>/
        ├── components_backend.json
        ├── components_data.json
        └── components_external.json
```

Les **sections de composants** (`components_*`) sont stagées **par projet** (`projects/<project_key>/`), donc plusieurs backends / microservices sous le même `arch_name` ne s'écrasent pas. Les **sections singleton** (identity, layers, connections, flow_summary) restent à plat — il n'y en a qu'une par SI. Au `merge_staged`/`finalize`, tous les fragments de tous les projets sont fusionnés dans `$.components` (dédup par `id`).

- `autoscan` dérive le `project_key` du nom du dossier (ou via le param `project_key`).
- `stage_fragment` accepte un `project_key` optionnel pour les sections `components_*`.
- Re-scanner un projet ne met à jour que son propre slot — les autres projets sont intacts.

## Multi-projets : une architecture, plusieurs scans

Quand un SI réel a plusieurs projets distincts (ex: MFE React + API Spring), tu les scannes l'un après l'autre **avec le même `arch_name`**. Le staging et le merge gèrent la fusion automatiquement.

```text
# 1. Ouvrir le MFE React dans VS Code
[USER] Scan ce projet pour architectviz, arch_name="cegec", sections identity + components_frontend.

[CLAUDE]
  → extract_identity / extract_components_frontend
  → stage_fragment("identity",          ..., "cegec")
  → stage_fragment("components_frontend", ..., "cegec")
    → .architectviz/staging/cegec/{identity,components_frontend}.json

# 2. Ouvrir l'API Spring dans VS Code (autre fenêtre ou réutiliser)
[USER] Scan ce projet pour architectviz, arch_name="cegec", section components_backend (skip identity).

[CLAUDE]
  → extract_components_backend
  → stage_fragment("components_backend", ..., "cegec")
    → .architectviz/staging/cegec/components_backend.json

# 3. Dériver les connexions cross-projet
[USER] Dérive les connexions ArchitectViz pour cegec.

[CLAUDE]
  → derive_connections("cegec")
    → match GET /api/v1/items (MFE) ↔ /api/v1/items (API) → ✅ MAPPÉ
    → stage_fragment("connections", ..., "cegec")

# 4. Merger
[USER] Merge le staging pour cegec.

[CLAUDE]
  → merge_staged("cegec")
    → src/architectures/cegec.json contient identity + components (FE + BE) + connections
```

`arch_name` est la **seule** clé de jointure. Tu peux scanner les deux projets dans le désordre, depuis deux IDEs différents, à des moments différents — tant que `arch_name` est le même, tout converge.

## Exemple complet — bout en bout

```text
[USER] Scan le workspace ouvert pour ArchitectViz. Nom: cegec-api. Sections identity + components_backend + components_frontend.

[CLAUDE]
  → list_sections()                                          # voir ce qui est disponible
  → extract_identity(project_path)                           # squelette identity
  → get_section_prompt("identity")                           # règles de complétion
  → (lit README.md pour reformuler description en métier)
  → validate_fragment("identity", fragment)                  # OK
  → stage_fragment("identity", fragment, "cegec-api")        # écrit staging/cegec-api/identity.json

  → extract_components_backend(project_path)                 # squelette Spring détecté
  → get_section_prompt("components_backend")
  → (lit src/main/java/**/*Controller.java pour les endpoints)
  → (lit SecurityConfig.java pour l'authentication)
  → validate_fragment(...)                                   # OK
  → stage_fragment("components_backend", fragment, "cegec-api")

  → extract_components_frontend(project_path)                # → detected: false (pas un frontend)
  (skip)

[USER] (relit .architectviz/staging/cegec-api/*.json, ajuste à la main si besoin)

[USER] Merge le staging pour cegec-api.

[CLAUDE]
  → merge_staged("cegec-api", dry_run: true)                 # preview
  → merge_staged("cegec-api")                                # écrit src/architectures/cegec-api.json
```

## Re-scan / mise à jour

Pour mettre à jour une architecture existante :
1. Re-lance les `extract_*` + `stage_fragment` sur le projet (le code a évolué).
2. `merge_staged` dédupliquera par clé d'identité — pas de doublons, les `description`/`note` rédigées à la main sont préservées (stratégie `preserve-manual` du manifeste).

## Troubleshooting

| Symptôme | Cause probable | Fix |
|---|---|---|
| Le client ne voit pas les outils | Chemin absolu incorrect dans la config | Vérifier que `dist/server.js` existe après `npm run build` |
| `Cannot find manifest` au boot | Le serveur cherche le manifeste à `<repo>/extraction-manifest.jsonc` | Le serveur doit être lancé depuis le repo `architectviz` (chemin résolu via `paths.ts`) |
| `extract_*` retourne `detected: false` | Le `project_path` ne pointe pas vers la racine du projet | Passer le chemin absolu de la racine (où vit `package.json` / `pom.xml` / `build.gradle*`) |
| `validate_fragment` rejette malgré `extract_*` propre | Champs `"À confirmer"` sur des `required: true` | Compléter via Claude avant `stage_fragment` |
| Le merge écrase un champ rédigé à la main | `merge.strategy` est `replace` pour ce champ | Vérifier la stratégie dans `extraction-manifest.jsonc` et ajuster si besoin |

## Limitations actuelles (MVP)

- **Routes frontend** non extraites — la détection AST par framework reste à implémenter (`src/extractors/components-frontend.ts`). Claude doit lire `src/` et appliquer `prompts/sections/components-frontend.md#routes`.
- **Endpoints backend** non extraits — idem pour les controllers Spring/NestJS/Express/FastAPI. Claude doit lire et appliquer `prompts/sections/components-backend.md#endpoints`.
- **Sections 5-6** (data, external) — extracteurs déterministes de squelette disponibles (`extract_components_data`, `extract_components_external`) ; le détail fin (`cached_data[]`, `tables[]`, descriptions) reste à compléter via Claude.
- **Sections 7-8** (connections, flow_summary) — pas d'extracteur dédié : `derive_connections`/`finalize` couvrent les connexions, le flow_summary est calculé par `recompute_summary`.
- **Identity sur projet Gradle** — le nom est extrait du README en fallback (pas de lecture de `settings.gradle*` pour l'instant).
- **UPDATE** : la stratégie `merge.preserve-manual` est implémentée dans `merge.ts` au niveau des items de liste (les valeurs existantes l'emportent au merge `{...existing, ...incoming}`). Pour les champs scalaires top-level, le merge écrase actuellement — à raffiner.

## Étendre le serveur

Pour ajouter un extracteur déterministe pour une autre section :

1. Créer `src/extractors/<section>.ts` qui exporte une fonction `(project_path) → { fragment, detected, notes }`.
2. Importer et déclarer un nouvel outil dans `src/server.ts` :
   ```ts
   server.tool(
     'extract_<section>',
     '...',
     { project_path: z.string() },
     async ({ project_path }) => textResult(extract<Section>(project_path)),
   );
   ```
3. `npm run build`, redémarrer le client MCP.

Pour ajuster la validation ou les stratégies de merge : édite [`extraction-manifest.jsonc`](../extraction-manifest.jsonc) — le serveur le relit à chaque appel (cache au boot).

## Voir aussi

- [extraction-manifest.jsonc](../extraction-manifest.jsonc) — source de vérité pour validation/merge
- [prompts/sections/](../prompts/sections/) — prompts compacts par section
- [src/architectures/_empty.jsonc](../src/architectures/_empty.jsonc) — template annoté du format de sortie
- [src/types.ts](../src/types.ts) — schéma TypeScript



« Scan ce projet pour ArchitectViz, arch_name="cegec". Sections : identity, components_backend, components_data (si DB/cache détecté), components_external (si IAM/services tiers détectés). »

« Scan ce projet pour ArchitectViz, arch_name="cegec" (même architecture). Section components_frontend. Ne refais pas identity, c'est déjà fait. »

« Finalise ArchitectViz pour cegec. »


lance l'autoscan sur ce projet, arch_name="nba"

