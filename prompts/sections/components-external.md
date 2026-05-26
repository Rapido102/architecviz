# Section 6 — Composants externes (iam, third-party, monitoring)

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[5]`](../../extraction-manifest.jsonc)

Composants `layer: "External"` : services non maîtrisés ou hors du périmètre du SI.

## Sortie attendue
```json
[
  {
    "id": "iam_keycloak",
    "label": "Keycloak IAM",
    "type": "iam",
    "layer": "External",
    "technology": "Keycloak 24",
    "url": "${KEYCLOAK_URL}",
    "endpoints": [
      { "path": "/realms/{realm}/protocol/openid-connect/token", "method": "POST" },
      { "path": "/realms/{realm}/protocol/openid-connect/userinfo", "method": "GET" }
    ],
    "used_by": ["backend_api"]
  },
  {
    "id": "account_api",
    "label": "Account API",
    "type": "third-party",
    "layer": "External",
    "technology": "REST API (OpenFeign 12.0+)",
    "url": "${ACCOUNT_API_URL}",
    "consumed_via": "OpenFeign (OkHttp + Jackson)",
    "external_ref": "account",
    "endpoints": [
      { "path": "/accounts/{id}", "method": "GET" }
    ],
    "used_by": ["backend_api"]
  }
]
```

## Méthode — détection par `type`

### `iam`
- `SecurityFilterChain` + provider OIDC URL (`spring.security.oauth2.client.provider.<x>.issuer-uri`)
- Keycloak adapter (`keycloak-spring-boot-starter`), Auth0 SDK, Cognito client (`amazon-cognito-identity-js`)
- IDP maison consommé via REST → toujours créer un composant IAM séparé, même si l'auth est aussi configurée dans le backend (section 4)
- `endpoints` : routes IDP appelées (`/token`, `/userinfo`, `/.well-known/openid-configuration`, `/verify-token`, `/get-roles`)

### `third-party`
- **Spring** : `@FeignClient(name="account", url="${spring.client.rest.account.url}")` → 1 composant par client distinct
- **WebClient / RestTemplate** avec base URL → 1 composant par hôte distinct
- **Node** : `axios.create({ baseURL: process.env.X_API })` → idem

Pour chacun :
- `technology` : `"REST API (OpenFeign 12.0+)"`, `"REST API (axios)"`, `"REST API (WebClient)"`, `"SOAP (JAX-WS)"`, etc.
- `url` : **laisser le placeholder** `${VAR}` (jamais une URL prod réelle)
- `consumed_via` : lib + transport (`"OpenFeign (OkHttp + Jackson)"`, `"axios 1.x"`, `"WebClient (Reactor Netty)"`)
- `endpoints[]` : routes appelées (annotations Feign sur l'interface, ou URLs construites)
- `used_by[]` : IDs des composants internes qui consomment ce service

### `monitoring`
- Datadog (`dd-trace`, agent), Prometheus (`/actuator/prometheus`, `prometheus-net`), OpenTelemetry exporter
- Sentry, ELK (`logback-logstash-encoder`, `winston-elasticsearch`), New Relic
- `technology` : `"Datadog Agent"`, `"OpenTelemetry SDK + OTLP exporter"`, etc.

### `service` (interne générique)
Utiliser **uniquement** si aucun autre type ne convient (ex: un backend interne non analysé séparément, qu'on traite comme une boîte noire).

## `external_ref` — relier les architectures entre elles

Quand un composant externe (`third-party` ou `service`) **est en réalité une autre stack cartographiée séparément**, renseigner `external_ref` avec le **slug canonique** de cette stack cible. C'est ce qui permet à ArchitectViz de relier automatiquement les architectures (ex. `isicrm` → `nba`, `curseur`).

- **Valeur attendue** : le slug canonique de la stack cible = nom de fichier de SON architecture (`nba.json` → `"nba"`, `curseur.json` → `"curseur"`), ou à défaut le `architecture` normalisé en kebab-case.
- **Quand le renseigner** : seulement si la cible fait partie du périmètre analysé (un autre projet git que tu cartographies). Sinon, laisser absent (vrai tiers non maîtrisé).
- **Bidirectionnel** : si A référence B et B référence A, mettre `external_ref` des deux côtés.

### Standardisation des noms (stacks & composants)

Pour que la mise en relation soit fiable, **nommer de façon déterministe** :

- **Slug de stack canonique** = `architecture` → minuscules → `[^a-z0-9]+` remplacé par `-` → trim. Ex. `"Bo Flow Distribution"` → `bo-flow-distribution` (le fichier reste `curseur` si historique, mais privilégier le slug canonique pour les nouveaux).
- **`id` de composant externe** = `<slug_cible>_api` en snake_case quand le composant représente une stack (ex. `flow_distribution_api`), sinon `<role>_<techno>` (`iam_keycloak`, `monitoring_datadog`).
- **`label`** = nom humain stable, identique entre les architectures qui pointent vers la même stack (ex. partout « Flow Distribution API »). Un label identique au backend exposé par la stack cible est le meilleur signal de liaison.
- **`external_ref`** = toujours le **slug de stack canonique** de la cible, jamais l'id local du composant.

## Validation
- Dédup par `id`.
- `type` : enum `iam | third-party | monitoring | service`
- `layer` : exactement `"External"`
- `url` : `^(https?://|\$\{)` (placeholder ou URL)
- `endpoints` : dédup par `(method, path)`
- `used_by[]` : chaque entrée doit référencer un `components[].id` interne existant

## Merge
- `id`, `label`, `note` → preserve-manual
- `technology`, `consumed_via`, `endpoints[]` → replace
- `url` → preserve-manual
- `used_by[]` → dedupe-append (peut être calculé depuis `connections[].to == this.id`)
