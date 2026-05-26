# Section 3 — Composants frontend

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[2]`](../../extraction-manifest.jsonc)

Composants de type `frontend` : SPA, MFE, PWA. Un composant par projet frontend.

## Sortie attendue
```json
[
  {
    "id": "frontend_react",
    "label": "React SPA Frontend",
    "type": "frontend",
    "layer": "Frontend",
    "technology": "React 19 + Vite 7 + TailwindCSS 3",
    "url": "${VITE_APP_URL}",
    "build_tool": "Vite 7",
    "state_management": "@tanstack/react-query 5.x (server-state) + zustand 4.x (client-state)",
    "key_dependencies": ["@tanstack/react-query 5.90.12", "react-hook-form 7.51.0"],
    "routes": [ ... ],
    "deployment": { ... }
  }
]
```

## Méthode

### Identité (`id`, `label`)
- `id` = `slugify(package.json:name)`, snake_case
- `label` = humanisé depuis `package.json:displayName` ou `id`

### `technology`
Inspecter `package.json:dependencies` et confirmer par au moins un import dans `src/` :

| Détection | Slot |
|---|---|
| `react`, `vue`, `@angular/core`, `svelte`, `next` | framework |
| `vite`, `webpack`, `turbopack`, `rspack`, `next` | bundler |
| `tailwindcss`, `@mui/*`, `antd`, `@chakra-ui/*` | UI |

Format strict : `"<lib1> X.Y + <lib2> A.B + ..."` (sans `^` ni `~`).

### `state_management`
- Server-state : `@tanstack/react-query`, `swr`, `apollo-client`
- Client-state : `redux`, `zustand`, `jotai`, `mobx`, `recoil`, `pinia`
- Form-state : `react-hook-form`, `formik`, `vee-validate`

Concaténer avec ` + ` : `"lib X.Y (rôle) + lib A.B (rôle)"`.

### `key_dependencies`
Lister les libs significatives non couvertes par `technology` :
- HTTP : `axios`, `ky`, `openapi-fetch`, libs internes `@<org>/*-http-lib`
- Auth : `oidc-client-ts`, `@auth0/*`, `keycloak-js`, libs internes `*-security-lib`
- Validation : `zod`, `yup`, `valibot`
- UI kits internes : `@<org>/ui`, `@<org>/design-system`

Format strict : `"<lib> X.Y.Z"` (version exacte de `package.json`, sans `^` ni `~`).

### `routes`
Détection par framework :

| Framework | Sources |
|---|---|
| React Router | grep `<Route path=`, `createBrowserRouter`, `useRoutes`, `createRoutesFromElements` |
| Next.js Pages | structure `pages/**` |
| Next.js App | structure `app/**/page.{tsx,jsx,ts,js}` |
| Vue Router | `router/index.*`, tableau `routes:` |
| Angular | `*-routing.module.ts`, `RouterModule.forRoot([...])` |

Pour chaque route :
```json
{
  "path": "/cegec/:id",
  "label": "Détail",
  "authenticated": true,
  "description": "1 ligne — déduire du JSX racine",
  "api_calls": ["GET /api/v1/cegec/items/{id}"]
}
```

- `authenticated: true` si la route est derrière un guard (`<ProtectedRoute>`, middleware, matcher de gateway).
- `api_calls` : tout appel HTTP émis depuis la page. Format strict `"METHOD /endpoint"`. Repérer :
  - `fetch(...)`, `axios.*`, `axios.create({ baseURL })`
  - hooks de fetch (`useQuery`, `useMutation`)
  - clients générés (`openapi-fetch`, `orval`, `kubb`)
  - wrappers internes (`@<org>/front-http-lib`)

### `deployment`
- `Dockerfile` → `containerized: true`, `platform: "Docker"`
- `.gitlab-ci.yml` / `.github/workflows/*` / `Jenkinsfile` → `ci_cd`
- `helm/`, `k8s/`, `manifests/`, `kustomization.yaml` → `orchestration: "Kubernetes"`
- Sinon : `"À confirmer"`

### `url`
Variables d'env (`VITE_APP_URL`, `NEXT_PUBLIC_URL`) ou README. Préférer le placeholder (`${VAR}`).

## Validation
- Dédup par `id`.
- `id` : `^[a-z0-9_-]+$`
- `type` : exactement `"frontend"`
- `layer` : doit matcher un `layers[].name`
- `routes` : dédup par `path`
- `api_calls[]` : pattern `^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.+`
- `key_dependencies[]` : pattern `^.+ \d+\.`

## Merge
- `id`, `label`, `description`, `note` → preserve-manual
- `technology`, `build_tool`, `state_management`, `deployment.platform/ci_cd` → replace
- `routes` → dédup par `path` + merge champ par champ (`description`, `label` preserve-manual ; `authenticated`, `api_calls` replace/dedupe-append)
- `key_dependencies`, `routes[].api_calls` → dedupe-append
