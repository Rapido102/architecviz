# Section 7 — Connexions

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[6]`](../../extraction-manifest.jsonc)

Flèches sur le canvas entre deux composants. **Dérivées des sections 3-6** : une connexion existe parce qu'un composant en appelle un autre.

## Sortie attendue
```json
[
  {
    "id": "frontend_to_backend",
    "from": "frontend_react",
    "to": "backend_api",
    "protocol": "REST/HTTPS",
    "authenticated": true,
    "description": "Appels synchrones du frontend vers l'API.",
    "client": "fetch",
    "flow": "Browser → JWT → API → Réponse",
    "endpoint_mappings": [
      {
        "frontend_endpoint": "GET /api/v1/items",
        "backend_endpoint": "/api/v1/items",
        "method": "GET",
        "frontend_pages": ["/"],
        "purpose": "Charger la liste paginée des items",
        "status": "✅ MAPPÉ"
      }
    ]
  }
]
```

## Méthode — règles de dérivation

| Source | Connexion à créer |
|---|---|
| `component[frontend].routes[].api_calls` groupés par hôte | 1 connexion frontend → composant cible (backend / third-party / iam) par hôte distinct |
| `component[backend].endpoints` consommant une DB (JPA, Prisma, etc.) | backend → db |
| `component[backend]` avec `@Cacheable` / `RedisTemplate` | backend → cache |
| `@KafkaListener`, `KafkaTemplate`, `@RabbitListener` | backend → mq (préciser direction publish/consume dans `operations`) |
| `@FeignClient`, `axios.create({ baseURL })` | backend → third-party |
| Validation JWT (`SecurityFilterChain`, middleware) | backend → iam |
| Exporter Datadog / OTel / Sentry | backend → monitoring |

### Construction d'une connexion

- `id` : `<from>_to_<to>` (snake_case)
- `protocol` selon la cible :
  - frontend → backend : `REST/HTTPS` (sauf `gRPC`, `GraphQL`, `WebSocket` détecté)
  - backend → db : `JDBC` | `PostgreSQL Wire` | `MongoDB Wire` (selon driver)
  - backend → cache : `Redis` | `Memcached`
  - backend → mq : `Kafka` | `AMQP` | `SQS` | `Pub/Sub`
  - backend → iam : `OIDC/HTTPS`
- `authenticated` :
  - propagation JWT/Bearer/mTLS/API key → `true`
  - appel anonyme (Redis interne, DB interne, OIDC discovery) → `false`
- `client` : nom de la lib utilisée (`fetch`, `axios`, `OpenFeign`, `WebClient`, `RedisTemplate`, `RestTemplate`)
- `flow` : 1 phrase décrivant le sens du flux (optionnel — aide à la lecture)
- `description` : usage et fréquence (optionnel)

### `endpoint_mappings[]` (pour les connexions REST)

Une entrée par endpoint appelé. Permet la traçabilité frontend ↔ backend.

```json
{
  "frontend_endpoint": "GET /api/v1/items",
  "backend_endpoint": "/api/v1/items",
  "method": "GET",
  "frontend_pages": ["/"],
  "purpose": "Charger la liste paginée des items",
  "status": "✅ MAPPÉ"
}
```

- `frontend_endpoint` : tel que construit côté code frontend (avec query/params si visibles)
- `backend_endpoint` : route exacte exposée par le backend (section 4)
- `frontend_pages` : routes frontend (section 3) qui effectuent cet appel
- `status` (calculé par le pipeline) :
  - `"✅ MAPPÉ"` : `frontend_endpoint` trouve son `backend_endpoint` dans `components[backend].endpoints`
  - `"⚠️ À VÉRIFIER"` : trouve avec différence de path mineure (variable de path, slash final…)
  - `"❌ NON MAPPÉ"` : non trouvé

### Connexions vers cache / mq

- `cache` : `operations: ["GET", "SET", "DELETE", "EXPIRE"]`, `cache_strategy: "Cache-aside" | "Write-through" | "Read-through" | "Write-behind"`
- `mq` : `operations: ["PUBLISH", "SUBSCRIBE"]`, `note` listant les topics

## Validation
- Dédup par `(from, to, protocol)`.
- `from`, `to` : doivent référencer un `components[].id` existant. Sinon → warning `CRITICAL` section 8.
- `endpoint_mappings` : dédup par `(method, frontend_endpoint)`
- `protocol` : libre mais privilégier les valeurs canoniques (`REST/HTTPS`, `gRPC`, `GraphQL`, `WebSocket`, `Kafka`, `AMQP`, `JDBC`, `Redis`, `OIDC/HTTPS`, `SOAP/REST`)

## Merge
- `id`, `description`, `note`, `flow` → preserve-manual
- `protocol`, `client`, `authenticated`, `cache_strategy` → replace
- `endpoint_mappings[]` → dédup par `(method, frontend_endpoint)` + merge :
  - `frontend_endpoint`, `backend_endpoint`, `method`, `status` → replace/compute
  - `purpose` → preserve-manual
  - `frontend_pages` → dedupe-append
- `operations[]` → dedupe-append
