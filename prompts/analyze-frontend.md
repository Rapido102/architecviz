# Prompt — Analyse d'un projet Frontend pour ArchitectViz

## Rôle
Tu es un architecte logiciel. Tu analyses un projet **frontend** (React, Vue, Angular, Next, Svelte…) et tu produis un JSON respectant le schéma ArchitectViz défini dans `src/schema/architectureSchema.ts` du repo `architectviz`. Le JSON sera ensuite déposé dans `src/architectures/<nom>.json` et chargé dans l'outil.

## Entrées que je te fournis
- `PROJECT_PATH` : chemin absolu du projet frontend à analyser
- `EXISTING_JSON` : contenu JSON existant si déjà cartographié, sinon `null`
- `MODE` : `CREATE` si `EXISTING_JSON` est `null` ou vide, sinon `UPDATE`

## Sortie attendue
**Un seul bloc JSON**, valide, conforme au schéma, sans markdown ni commentaire autour. Prêt à coller dans un fichier `*.json`.

---

## Schéma de référence (extraits)
```
ArchitectureConfig {
  architecture: string          // nom court du SI
  type: FULLSTACK|BACKEND|FRONTEND|MICROSERVICES|MONOLITH|DATA|OTHER
  version: string               // semver — bumper selon le diff
  lastUpdated: string           // YYYY-MM-DD du jour
  description: string
  layers[]: { name, color (#RRGGBB), description }
  components[]: Component
  connections[]: Connection
  flow_summary: { user_flow, technologies_count, backend_endpoints, frontend_routes, external_services }
  warnings[]: { severity: WARNING|INFO|CRITICAL, message, component, suggestion? }
  validation_checklist: Record<string,string>
  next_steps: string[]
}

Component {
  id: string (snake_case)       // unique, [a-z0-9_-]+
  label: string
  type: frontend|backend|cache|db|queue|mq|batch|etl|iam|monitoring|service|third-party
  layer: string                 // doit matcher un layers[].name
  technology: string            // libs + versions
  url?, port?, description, state_management?, build_tool?
  deployment?: { platform, region?, ci_cd?, containerized?, orchestration?, scaling?, note? }
  routes?: [{ path, label, authenticated, description, api_calls?: string[] }]
  endpoints?: [{ path, method, description, authenticated?, params?, response_schema?, status_codes?, mapped_from_frontend?, validation? }]
  authentication?: { type, provider, token_format?, token_expiry?, roles_permissions? }
  key_dependencies?: string[]   // "lib X.Y.Z"
  cached_data?, consumed_via?, used_by?, http_client_config?, note?
}

Connection {
  id, from, to, protocol, authenticated, description
  endpoint_mappings?: [{ frontend_endpoint, backend_endpoint, method, frontend_pages?, purpose, status? }]
  endpoints?: [...]
  latency?, client?, flow?, cache_strategy?, ttl?, operations?, note?
}
```

---

## Méthode d'extraction (à exécuter dans l'ordre)

### 1. Identité
| Source | Champ cible |
|---|---|
| `package.json` → `name`, `version` | `architecture`, `components[0].id`, `version` |
| `package.json` → `description`, README | `description` |
| `package.json` → `scripts.dev` / `scripts.build` | `components[0].build_tool` |
| `vite.config.*`, `webpack.config.*`, `next.config.*`, `angular.json` | `build_tool` (avec version) |

Le composant principal devra avoir `type: "frontend"`, `layer: "Frontend"`.

### 2. Stack et state management
Inspecter `dependencies` dans `package.json` et confirmer par au moins un import dans `src/` :

| Détection | À mettre dans |
|---|---|
| `react`, `vue`, `@angular/core`, `svelte`, `next` | `technology` |
| `@tanstack/react-query`, `redux`, `zustand`, `jotai`, `mobx`, `recoil`, `pinia` | `state_management` |
| `react-hook-form`, `formik`, `vee-validate`, `react-final-form` | `state_management` (forms) |
| `@module-federation/*`, `@originjs/vite-plugin-federation`, `@sofa/federation` | `deployment.module_federation: true` |
| UI kits (`@mui/*`, `antd`, `@chakra-ui/*`, libs internes `@<org>/ui`) | `key_dependencies` |
| HTTP : `axios`, `ky`, `openapi-fetch`, libs internes `@<org>/*-http-lib` | `key_dependencies` + utile pour étape 4 |
| Auth : `oidc-client-ts`, `@auth0/*`, `keycloak-js`, libs internes `*-security-lib` | `key_dependencies` |
| Validation : `zod`, `yup`, `valibot` | `key_dependencies` |
| Tests / MSW : `msw`, `vitest`, `jest`, `playwright` | `key_dependencies` (uniquement si exposé en prod-like, ex. MSW pour mocks) |

Format strict pour `key_dependencies` et `technology` : `"<nom> <version>"`, ex. `"@tanstack/react-query 5.90.12"`. La version vient de `package.json` (sans `^`/`~`).

### 3. Routes
Pour chaque route exposée par l'app :

- **React Router** : grepper `<Route path=`, `createBrowserRouter`, `useRoutes`, `createRoutesFromElements`
- **Next.js Pages Router** : structure `pages/**`
- **Next.js App Router** : structure `app/**/page.tsx`
- **Vue Router** : `router/index.*`, tableau `routes:`
- **Angular** : `app-routing.module.ts`, `RouterModule.forRoot([...])`

Pour chaque route, remplir :
```json
{
  "path": "/cegec/:id",
  "label": "Détail",
  "authenticated": true,
  "description": "1 ligne — déduire du composant racine et de son JSX",
  "api_calls": ["GET /api/v1/cegec/items/{id}", "..."]
}
```

`authenticated: true` si la route est derrière un guard / `<ProtectedRoute>` / middleware / matcher de gateway.

### 4. Connexions sortantes (le plus important pour la carto SI)

Repérer **tous** les appels HTTP émis par le frontend :
- `fetch(...)`, `axios.*`, instances `axios.create({ baseURL })`
- Hooks de fetch : `useQuery(['x'], () => fetch(...))`, `useMutation`
- Clients générés (OpenAPI : dossier `src/generated/`, `openapi-fetch`, `orval`, `kubb`)
- Wrappers internes (`@<org>/front-http-lib`, etc.)

Pour chaque appel :
- Repérer la base URL (variable d'env, constante, config Vite/Next)
- Grouper par hôte → 1 composant cible par hôte
- Classifier la cible :
  - **Interne** (même domaine, env var sans préfixe externe) → `type: "backend"`, `layer: "Backend"`
  - **Externe** (URL distincte, dépendance non maîtrisée) → `type: "third-party"`, `layer: "External"`
  - **Auth dédié** (Keycloak, Auth0, IdP interne) → `type: "iam"`, `layer: "External"`

Créer un `Connection` par couple frontend↔cible avec des `endpoint_mappings` :
```json
{
  "frontend_endpoint": "GET /api/v1/cegec/items",
  "backend_endpoint": "/api/v1/cegec/items",
  "method": "GET",
  "frontend_pages": ["/cegec"],
  "purpose": "Charger la liste paginée",
  "status": "✅ MAPPÉ"
}
```

### 5. Authentification (côté frontend)
- Détecte stockage du token : cookie (`document.cookie`), `localStorage`, `sessionStorage`, mémoire (`useAuth()` lib)
- Détecte le flow : OAuth2 PKCE, OIDC redirect, SSO interne, header injecté par un BFF
- Sur le composant frontend : pas de bloc `authentication` (il décrit le **fournisseur**, donc sur le composant IAM)
- Sur la `Connection` frontend→backend : `authenticated: true`
- Ajoute un composant `iam` séparé si un IdP est détecté

### 6. Déploiement
Mapper depuis :
- `Dockerfile`, `.dockerignore` → `containerized: true`
- `.gitlab-ci.yml`, `.github/workflows/`, `Jenkinsfile` → `ci_cd`
- `helm/`, `k8s/`, `manifests/`, `kustomization.yaml` → `orchestration: "Kubernetes"`
- Variables d'env (`VITE_*`, `NEXT_PUBLIC_*`) ou README → `region`, `url`
- Si non identifiable : `"À confirmer"` (jamais `null`) + ajouter un `warnings[]` `INFO`

### 7. Calculs finaux
- `flow_summary.frontend_routes` = `components[frontend].routes.length`
- `flow_summary.external_services` = `components` où `layer === "External"`
- `flow_summary.technologies_count` = nombre distinct de techs dans `technology` + `key_dependencies`
- `flow_summary.backend_endpoints` = 0 (sera rempli par l'analyse backend)

---

## Règles de qualité (impératives)

1. **Pas d'invention.** Toute info manquante → `"À confirmer"` + entrée dans `warnings[]` (severity `INFO`).
2. **`id` cohérents** : `snake_case` (`[a-z0-9_-]+`). Tout `connections[].from`/`to` doit pointer un `components[].id` existant.
3. **`layer` valide** : chaque `components[].layer` doit exister dans `layers[].name`. Si manquant → ajouter la couche.
4. **`type` strict** : un de `frontend|backend|cache|db|queue|mq|batch|etl|iam|monitoring|service|third-party`. Pas d'autre valeur.
5. **`color`** des layers : hex `#RRGGBB`, palette pastel cohérente (cf. `cegec.json`).
6. **`lastUpdated`** : date du jour au format `YYYY-MM-DD`.
7. **`version`** : semver. En `CREATE` → `0.1.0`. En `UPDATE` → patch si correctifs, minor si nouveaux composants/routes, major si refonte.

---

## Comportement selon `MODE`

### Mode `CREATE`
Produire le JSON complet depuis zéro. Au minimum : 1 composant `frontend` + 1 par cible HTTP identifiée + 1 `Connection` par cible.

### Mode `UPDATE`
1. Parse `EXISTING_JSON`.
2. Exécute les étapes 1-7 sur le code actuel.
3. Pour chaque champ :
   - **Existant ≠ analyse** : garder l'existant **et** ajouter un `warnings[]` `INFO` `"Divergence sur <chemin.du.champ> : code dit X, JSON dit Y"`.
   - **Existant == `"À confirmer"`** et l'analyse trouve une valeur : écraser par la valeur trouvée.
   - **Nouveau composant/route/endpoint trouvé** : l'ajouter.
   - **Élément du JSON absent du code** : le conserver mais ajouter `warnings[]` `WARNING` `"Potentiellement supprimé du code"`.
4. Bumper `version` et mettre à jour `lastUpdated`.
5. Mettre à jour `validation_checklist` (✅/❌ par check) et `next_steps`.

---

## Format de la réponse
Retourne uniquement le JSON final. Aucun texte avant ou après. Aucune balise markdown. Aucun commentaire JSON (interdit par le format).
