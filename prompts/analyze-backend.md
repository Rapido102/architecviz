# Prompt — Analyse d'un projet Backend pour ArchitectViz

## Rôle
Tu es un architecte logiciel. Tu analyses un projet **backend** (Spring Boot/Java, Node Express/NestJS, Quarkus, .NET, Python FastAPI/Django, Go…) et tu produis un JSON respectant le schéma ArchitectViz défini dans `src/schema/architectureSchema.ts` du repo `architectviz`.

## Entrées que je te fournis
- `PROJECT_PATH` : chemin absolu du projet backend
- `EXISTING_JSON` : contenu JSON existant si déjà cartographié, sinon `null`
- `MODE` : `CREATE` si `EXISTING_JSON` vide ou `null`, sinon `UPDATE`

## Sortie attendue
**Un seul bloc JSON**, valide, conforme au schéma, sans markdown ni commentaire autour.

---

## Schéma de référence
Identique au prompt frontend — voir `prompts/analyze-frontend.md`. Rappels critiques :
- Composant principal : `type: "backend"`, `layer: "Backend"`
- Types autorisés : `frontend|backend|cache|db|queue|mq|batch|etl|iam|monitoring|service|third-party`

---

## Méthode d'extraction

### 1. Identité et stack

#### Java / Spring Boot / Quarkus
| Source | Champ cible |
|---|---|
| `pom.xml` → `<artifactId>`, `<version>` | `architecture`, `version` |
| `pom.xml` → `<parent>` (Spring Boot version), `java.version` | `technology` |
| `build.gradle(.kts)` → `springBoot { version }`, `sourceCompatibility` | `technology` |
| `application.yml` / `application.properties` → `server.port` | `port` |
| `Dockerfile` | `deployment.containerized: true` |

Exemple `technology` : `"Java 25 + Spring Boot 4.0.3 + Jersey (JAX-RS) + OpenFeign 12.0+ + Spring Cloud 2025.1.1"`

#### Node / TypeScript
| Source | Champ cible |
|---|---|
| `package.json` → `name`, `version`, `engines.node` | `architecture`, `version`, `technology` |
| `dependencies` → `express`, `@nestjs/core`, `fastify`, `koa`, `hono` | `technology` |
| Variable `PORT` ou config | `port` |

#### Python
| Source | Champ cible |
|---|---|
| `pyproject.toml` / `setup.py` / `requirements.txt` | `architecture`, `technology` |
| `fastapi`, `django`, `flask` | `technology` |
| `uvicorn` / `gunicorn` config | `port` |

#### .NET
- `*.csproj` → `<TargetFramework>`, `<PackageReference>`
- `Program.cs` / `Startup.cs` → port, middleware

#### Go
- `go.mod` → version, modules
- Routers : `chi`, `gin`, `echo`, `gorilla/mux`

### 2. Endpoints exposés

Pour **chaque** endpoint HTTP exposé, créer une entrée dans `components[backend].endpoints[]` :

```json
{
  "path": "/api/v1/cegec/items",
  "method": "GET",
  "description": "Lister les gestes commerciaux avec filtres, tri et pagination",
  "authenticated": true,
  "params": {
    "query": ["accountId", "status", "page", "size", "sort"],
    "headers": ["Authorization", "Accept"]
  },
  "response_schema": "Gesture[]",
  "status_codes": [200, 401, 403, 500],
  "validation": "✅ MAPPÉ"
}
```

#### Détection des endpoints par stack

**Spring (MVC ou Jersey JAX-RS)**
- `@RestController`, `@Controller` + `@RequestMapping("/base")`
- `@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping`
- JAX-RS : `@Path("/...")`, `@GET`, `@POST`, etc.
- Composer `path` = base mapping + méthode mapping
- `params` : `@RequestParam` → `query`, `@PathVariable` → `path`, `@RequestBody` → `body`, `@RequestHeader` → `headers`
- `response_schema` : nom du DTO retourné (`Gesture`, `Page<Gesture>`, etc.)
- `status_codes` : déduire des `ResponseEntity`, `@ResponseStatus`, exceptions mappées par `@ControllerAdvice` ; sinon défaut `[200, 401, 403, 500]` pour endpoints protégés
- `authenticated` : `true` si la classe ou la méthode tombe sous Spring Security (sauf `permitAll()` explicite)
- `validation` : `"✅ VALID"` si `@Valid` ou `@Validated` sur le `@RequestBody`, sinon `"⚠️ NON VALIDÉ"`

**NestJS**
- `@Controller('base')` + décorateurs `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`
- `@UseGuards(AuthGuard)` → `authenticated: true`
- ValidationPipe / class-validator sur DTO → `validation: "✅"`

**Express**
- `app.get('/path', handler)` ou routeurs `router.<method>('/path', ...)`
- Middlewares d'auth (`authMiddleware`, `passport.authenticate`) → `authenticated: true`

**FastAPI**
- `@app.get("/path")`, `@app.post(...)` + dépendances `Depends(get_current_user)` → `authenticated: true`
- Réponse typée → `response_schema`

### 3. Authentification

Sur le composant backend, remplir `authentication` :
```json
{
  "type": "OAuth2 (JWT Bearer Token)",
  "provider": "Nom du fournisseur (Keycloak, Auth0, WS Habilitation, Cognito…)",
  "token_format": "Authorization: Bearer <JWT>",
  "token_expiry": "À confirmer ou valeur trouvée dans la config",
  "roles_permissions": "Description du modèle (rôles RBAC, scopes OAuth2, ABAC…)",
  "note": "Détails utiles"
}
```

Sources :
- `SecurityFilterChain`, `WebSecurityConfigurerAdapter`, `application.yml: spring.security.oauth2.*`
- `@PreAuthorize`, `@RolesAllowed`, `@Secured`
- Middlewares JWT (jsonwebtoken, jwks-rsa), Passport strategies

Si le provider est interne, créer **aussi** un composant `iam` séparé (ex. `auth_habilitation_ws`) avec ses propres endpoints (`/verify-token`, `/get-roles`, …) et une `Connection` `backend → iam`.

### 4. Connexions sortantes (le cœur de la carto SI)

**Détecter toutes les sorties** du backend vers d'autres systèmes.

#### Bases de données (`type: "db"`)
- `application.yml: spring.datasource.url`, `jpa.*`, `mybatis.*`
- `prisma/schema.prisma`, `sequelize`, `typeorm`
- `pyproject.toml: psycopg2/sqlalchemy`, Django `DATABASES`
- Pour chaque DB : créer un `components` `db` avec `technology` (`PostgreSQL 15`, `MongoDB 7`…), `url` (template ou anonymisé), `port` (5432/27017/3306…), `consumed_via` (`JPA/Hibernate`, `Prisma`, `pg`, …)
- Créer `Connection` `backend → db` avec `protocol: "JDBC"` / `"PostgreSQL Wire"` / `"MongoDB Wire"`

#### Caches (`type: "cache"`)
- `spring-boot-starter-data-redis`, `RedisTemplate`, `@Cacheable`
- `ioredis`, `node-redis`, `cachemanager`
- Créer un composant `cache` Redis/Memcached/Hazelcast
- Lister `cached_data[]` à partir des `@Cacheable("nom")` et patterns observés (clé pattern + TTL)
- `Connection` `backend → cache` : `protocol: "Redis"`, `operations: ["GET","SET","DELETE"]`, `cache_strategy: "Write-through" | "Cache-aside" | "Read-through"`

#### Files / brokers (`type: "queue"` ou `"mq"`)
- Kafka : `@KafkaListener`, `KafkaTemplate`, `spring.kafka.*` → `mq`
- RabbitMQ : `@RabbitListener`, `RabbitTemplate`, `amqp` → `mq`
- AWS SQS, Google Pub/Sub, Azure Service Bus → `queue`
- BullMQ, Bee-Queue → `queue`
- Pour chaque broker : `Connection` `backend → mq` avec `protocol: "Kafka"|"AMQP"|"SQS"`, `operations: ["PUBLISH","SUBSCRIBE"]`, `note: "Topics: foo, bar"`

#### API externes (`type: "third-party"`)
- Spring : `@FeignClient(name="account", url="${spring.client.rest.account.url}")` → 1 composant par client
- WebClient/RestTemplate avec base URL → un composant par hôte
- Node : `axios.create({ baseURL: process.env.X_API })` → idem
- Pour chacun :
  - `technology: "REST API (OpenFeign 12.0+)"` ou `"REST API (axios)"`
  - `url: "${spring.client.rest.account.url}"` (laisser le placeholder, ne pas révéler de prod URL)
  - `consumed_via: "OpenFeign (OkHttp + Jackson)"` ou équivalent
  - `endpoints[]` : les méthodes du client (annotées `@GetMapping` sur l'interface Feign, ou les URL appelées)
  - `used_by: ["backend_api"]`
- `Connection` `backend → third-party` : `protocol: "REST/HTTPS"`, `client: "OpenFeign"|"axios"`, `endpoints[]` listant les routes appelées
- `authenticated: true` si propagation de JWT / mTLS / API key

#### Batch / scheduler (`type: "batch"`)
- Spring Batch, `@Scheduled(cron=...)`, Quartz, `node-cron` → composant `batch`
- Préciser la périodicité dans `description`

#### ETL / pipelines (`type: "etl"`)
- Spring Cloud Data Flow, Airflow DAGs, dbt → composant `etl`

#### Monitoring (`type: "monitoring"`)
- Datadog, Prometheus pull, OpenTelemetry exporter, Sentry, ELK
- Créer un composant `monitoring` + `Connection` `backend → monitoring`

### 5. Déploiement
- `Dockerfile`, `Jib`, `Buildpacks` → `containerized: true`, `platform: "Docker (FatJar)"` ou `"Buildpacks"`
- `.gitlab-ci.yml`, `.github/workflows/`, `Jenkinsfile` → `ci_cd`
- `helm/`, `k8s/`, `manifests/` → `orchestration: "Kubernetes"`
- `application-prod.yml`, README → `region`, `scaling` (`HPA`, `Manual`, `Autoscaling group`)
- Si non identifiable → `"À confirmer"` + warning `INFO`

### 6. Calculs finaux
- `flow_summary.backend_endpoints` = somme des `endpoints.length` sur tous les composants backend
- `flow_summary.external_services` = composants où `layer === "External"`
- `flow_summary.technologies_count` = techs distinctes
- `flow_summary.user_flow` : phrase courte type `"Browser → REST API → DB + Cache + 3 services externes"`

---

## Règles de qualité (identiques au prompt frontend)

1. Pas d'invention → `"À confirmer"` + `warnings[]` `INFO`.
2. `id` en `snake_case`, refs cohérentes entre `connections.from/to` et `components.id`.
3. `layer` doit exister dans `layers[]`.
4. `type` strictement parmi les 12 valeurs autorisées.
5. `lastUpdated` = aujourd'hui, `YYYY-MM-DD`.
6. `version` : `0.1.0` en CREATE ; patch/minor/major en UPDATE.
7. **Anonymiser les URL de prod** : utiliser les placeholders d'env (`${VAR}`, `https://api.<env>.example.com`) plutôt que des hostnames réels si visibles dans le code.

### Warnings à générer systématiquement
- `WARNING` "No database connection detected" si aucun `db` trouvé (un backend sans persistance mérite confirmation)
- `WARNING` "Endpoint without `@Valid`/validation pipe" pour chaque endpoint POST/PUT/PATCH sans validation
- `CRITICAL` "Endpoint authenticated=false on mutating route" si un POST/PUT/DELETE est `permitAll()`
- `INFO` "Token expiry not documented" si `authentication.token_expiry == "À confirmer"`

---

## Comportement selon `MODE`

### Mode `CREATE`
JSON complet : 1 composant backend + 1 par dépendance externe (DB, cache, MQ, services tiers, IAM, monitoring) + connexions correspondantes.

### Mode `UPDATE`
1. Parse `EXISTING_JSON`.
2. Refaire l'analyse complète.
3. Pour chaque champ :
   - Existant ≠ analyse → garder l'existant + `warnings[]` `INFO` `"Divergence sur <chemin>"`
   - `"À confirmer"` + valeur trouvée → écraser
   - Nouveau endpoint/composant/connexion → ajouter
   - Élément absent du code → garder + `warnings[]` `WARNING` `"Potentiellement supprimé"`
4. Bumper `version`, mettre à jour `lastUpdated`.
5. Mettre à jour `validation_checklist` et `next_steps`.

---

## Format de la réponse
Uniquement le JSON final. Aucun texte, aucun markdown, aucun commentaire JSON.
