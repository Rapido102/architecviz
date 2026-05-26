# Section 4 — Composants backend

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[3]`](../../extraction-manifest.jsonc)

Composants de type `backend` : API REST, gRPC, BFF. Un composant par projet backend / microservice.

## Sortie attendue
```json
[
  {
    "id": "backend_api",
    "label": "Spring Boot API",
    "type": "backend",
    "layer": "Backend",
    "technology": "Java 25 + Spring Boot 4.0.3 + Jersey (JAX-RS)",
    "url": "${API_URL}",
    "port": 8080,
    "authentication": { ... },
    "endpoints": [ ... ],
    "deployment": { ... }
  }
]
```

## Pré-extraction déterministe (autoscan)

`autoscan` remplit déjà automatiquement, avec `provenance: "auto"` :
- `endpoints[]` : path + method (Spring MVC `@*Mapping`, **JAX-RS/Jersey `@Path`+`@GET`**, NestJS, Express, FastAPI) ;
- `coverage` : nb de fichiers scannés, contrôleurs trouvés, **angles morts** (auth non évaluée, préfixes Express non résolus…) ;
- `data_access_candidates[]` : signaux détectés (`@Query`/`@Modifying`, `*Mapper.xml`, repo Spring Data, `@Cacheable`, `kafkaTemplate.send`/`@KafkaListener`).

Ton rôle dans la passe LLM est de **vérifier et enrichir**, pas de tout re-saisir :
- Confirme/corrige les `endpoints[]` auto et passe leur `provenance` à `"llm"` (ou `"manual"` si tu l'as vérifié sur le code). Complète `description`, `params`, `status_codes`.
- **Contrat d'API** : remplis `response_fields[]` / `request_fields[]` depuis les DTO/records (`{ "name", "type", "description?", "required?" }`).
- **data_access** : rattache chaque candidat à l'endpoint qui le déclenche (suivre la chaîne controller→service→repository), avec `provenance: "llm"`. Les candidats non rattachables restent à investiguer (signale-les).
- **Organisation** : renseigne `owner` / `team` / `criticality` (`low|medium|high|critical`) / `environment` si l'info existe (CODEOWNERS, README, manifests).
- **`validation`** : valeurs canoniques `VALID | UNVERIFIED | INVALID` (les libellés emoji restent tolérés).

### `technology` par stack

| Stack | Sources |
|---|---|
| Spring Boot / Quarkus | `pom.xml` → `<parent>` (Spring Boot version), `<java.version>` ; ou `build.gradle(.kts)` → `springBoot { version }`, `sourceCompatibility` |
| Node | `package.json:dependencies` → `express`, `@nestjs/core`, `fastify`, `koa`, `hono` |
| Python | `pyproject.toml` / `requirements.txt` → `fastapi`, `django`, `flask` |
| .NET | `*.csproj` → `<TargetFramework>`, `<PackageReference>` |
| Go | `go.mod` + routers `chi`, `gin`, `echo`, `gorilla/mux` |

Format : `"<runtime version> + <framework> X.Y + <key libs>"`.

### `port`
- `application*.yml` → `server.port`
- `application.properties` → `server.port=`
- `.env*` → `PORT=`
- `src/**/main.{ts,js,py,go}` → argument de `listen()` / `run()`

### `authentication` (le composant porte le mécanisme)
```json
{
  "type": "OAuth2 (JWT Bearer Token)",
  "provider": "Keycloak | Auth0 | WS Habilitation | Cognito | ...",
  "token_format": "Authorization: Bearer <JWT>",
  "token_expiry": "1h | 24h | À confirmer",
  "roles_permissions": "RBAC (rôles) | Scopes OAuth2 | ABAC | ...",
  "note": ""
}
```

Sources :
- `SecurityFilterChain`, `WebSecurityConfigurerAdapter`, `application.yml: spring.security.oauth2.*`
- `@PreAuthorize`, `@RolesAllowed`, `@Secured`
- Middlewares JWT (`jsonwebtoken`, `jwks-rsa`), Passport strategies
- NestJS : `@UseGuards`

Si le provider est interne (Keycloak, IDP maison), un composant `iam` séparé sera créé en section 6.

### `endpoints`

Détection par framework :

| Framework | Décorateurs / patterns |
|---|---|
| Spring MVC | `@RestController`, `@RequestMapping("/base")`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping` |
| Spring JAX-RS | `@Path("/...")`, `@GET`, `@POST`, `@PUT`, `@DELETE` |
| NestJS | `@Controller('base')`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` |
| Express | `app.get('/path', ...)`, `router.<method>('/path', ...)` |
| FastAPI | `@app.get("/path")`, `@app.post(...)`, `@router.<method>(...)` |
| Go | `r.GET(...)`, `r.POST(...)`, `http.HandleFunc(...)` |

Pour chaque endpoint :
```json
{
  "path": "/api/v1/items",
  "method": "GET",
  "description": "Lister les items avec filtres, tri et pagination",
  "authenticated": true,
  "params": {
    "query":   ["page", "size", "sort"],
    "path":    [],
    "body":    [],
    "headers": ["Authorization"]
  },
  "response_schema": "Item[]",
  "status_codes": [200, 401, 403, 500],
  "validation": "✅ VALID"
}
```

Règles de déduction :
- `path` = base mapping (`@RequestMapping`/`@Controller`) + méthode mapping
- `params` :
  - `@RequestParam` / FastAPI `Query` → `query`
  - `@PathVariable` / FastAPI path arg → `path`
  - `@RequestBody` / Pydantic body → `body`
  - `@RequestHeader` → `headers`
- `response_schema` : nom du DTO (`Item`, `Page<Item>`, etc.)
- `status_codes` : déduits de `ResponseEntity`, `@ResponseStatus`, exceptions mappées (`@ControllerAdvice`) ; défaut endpoint protégé : `[200, 401, 403, 500]`
- `authenticated` : `true` si la classe/méthode tombe sous Spring Security sauf `permitAll()` ; ou `@UseGuards`, `@Authenticated`, `@login_required`, middleware d'auth
- `validation` :
  - `"✅ VALID"` si `@Valid` / `@Validated` sur le `@RequestBody`, ValidationPipe NestJS, Pydantic FastAPI
  - `"⚠️ NON VALIDÉ"` sinon

### `endpoints[].data_access` (impact analysis & data lineage)

Pour **chaque endpoint**, lister les ressources externes qu'il touche : tables SQL, clés de cache, topics MQ, endpoints de services tiers. Une entrée par ressource × opération.

```json
"data_access": [
  { "component_id": "db_postgres", "resource": "items",           "operation": "SELECT" },
  { "component_id": "db_postgres", "resource": "item_categories", "operation": "SELECT" },
  { "component_id": "cache_redis", "resource": "item:{id}",        "operation": "GET", "note": "TTL 10m" },
  { "component_id": "account_api", "resource": "/accounts/{id}",   "operation": "GET" },
  { "component_id": "mq_kafka",    "resource": "items.events",     "operation": "PUBLISH" }
]
```

**Méthode de détection** (suivre la chaîne d'appel `Controller → Service → Repository → ressource`) :

| Stack | Comment trouver les `data_access` |
|---|---|
| **Spring + JPA** | Repository injecté dans le service appelé par l'endpoint. Pour chaque méthode du repository : `findBy*` → `SELECT`, `save` → `INSERT`/`UPDATE` (selon ID), `delete` → `DELETE`. La table vient de `@Entity` + `@Table(name="...")` sur l'entité. |
| **Spring + MyBatis** | `*Mapper.xml` ou `@Mapper` interface. Chaque méthode appelée → SQL associé → tables référencées. |
| **Spring `@Cacheable`** | Annotation sur la méthode service appelée. `@Cacheable("items")` → `{ component_id: "cache_redis", resource: "items", operation: "GET" }`. Cache-aside : ajouter aussi `SET` au premier hit. |
| **@FeignClient** | Interface Feign appelée → chaque méthode = un appel REST → `{ component_id: <id du composant third-party>, resource: <path>, operation: <METHOD> }`. |
| **Kafka** | `KafkaTemplate.send(topic, ...)` → `PUBLISH`. `@KafkaListener(topics="...")` côté consumer → `SUBSCRIBE`. |
| **NestJS** | `@InjectRepository(Entity)` ou `prisma.<model>.<verb>()` dans le service. `findMany` → `SELECT`, `create` → `INSERT`, `update` → `UPDATE`, `delete` → `DELETE`. |
| **FastAPI** | `session.query(Entity)` / `session.execute(stmt)` → entité → table. SQLAlchemy Core : parser le `stmt`. |
| **Raw SQL** | grep `SELECT ... FROM <table>` / `INSERT INTO <table>` / `UPDATE <table>` / `DELETE FROM <table>` dans les méthodes appelées. |

**Règles** :
- `component_id` doit matcher un `components[].id` existant (db, cache, mq, third-party). Sinon → ajouter le composant manquant côté section 5 ou 6.
- `resource` est libre : nom de table SQL (`items`), pattern Redis (`item:{id}`), topic Kafka (`items.events`), path REST (`/accounts/{id}`).
- `operation` est libre mais aligner sur les conventions :
  - SQL : `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`
  - Cache : `GET`, `SET`, `DEL`, `EXPIRE`, `INVALIDATE`
  - MQ : `PUBLISH`, `SUBSCRIBE`
  - REST : `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- Une entrée par couple unique `(component_id, resource, operation)`. Si un endpoint fait à la fois `SELECT` et `INSERT` sur `items`, deux entrées.
- Si tu hésites ou que la chaîne d'appel est trop profonde : `note: "À tracer manuellement"` plutôt qu'omettre.

### `deployment`
- `Dockerfile`, `Jib`, `Buildpacks` → `containerized: true`, `platform`
- `.gitlab-ci.yml`, `.github/workflows/*`, `Jenkinsfile` → `ci_cd`
- `helm/`, `k8s/`, `manifests/` → `orchestration: "Kubernetes"`
- `application-prod.yml`, README → `region`, `scaling` (`HPA`, `Manual`, `Autoscaling group`)

## Validation
- Dédup par `id`.
- `type` : exactement `"backend"`
- `port` : entier 1-65535
- `endpoints` : dédup par `(method, path)`
- `endpoints[].method` : enum strict
- `endpoints[].data_access` : dédup par `(component_id, resource, operation)` ; `component_id` doit référencer un `components[].id` existant

## Merge
- `id`, `label`, `description`, `note`, `authentication.note` → preserve-manual
- `technology`, `port`, `endpoints[]`, `deployment.*` (sauf `note`) → replace
- `authentication.provider`, `token_expiry`, `roles_permissions` → prefer-non-empty
- `endpoints[].description`, `endpoints[].note` → preserve-manual
- `endpoints[].status_codes` → dedupe-append
