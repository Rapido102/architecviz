# Section 5 — Composants Data (db, cache, queue, mq, etl, batch)

> Préambule : [_common.md](_common.md) · Manifeste : [`sections[4]`](../../extraction-manifest.jsonc)

Composants de persistance et de messaging détectés depuis le code backend. Un composant par instance distincte (1 DB, 1 cache, 1 broker…).

## Sortie attendue
```json
[
  {
    "id": "db_postgres",
    "label": "PostgreSQL",
    "type": "db",
    "layer": "Data",
    "technology": "PostgreSQL 15",
    "url": "${POSTGRES_URL}",
    "port": 5432,
    "consumed_via": "JPA / Hibernate"
  },
  {
    "id": "cache_redis",
    "label": "Redis Cache",
    "type": "cache",
    "layer": "Data",
    "technology": "Redis 7",
    "port": 6379,
    "consumed_via": "RedisTemplate + @Cacheable",
    "cached_data": [
      { "endpoint": "/api/v1/params", "key_pattern": "app:params:*", "ttl": "1h", "purpose": "Paramètres applicatifs globaux" }
    ]
  }
]
```

## Méthode — détection par `type`

### `db`
| Source | Tech à reporter |
|---|---|
| `application*.yml` → `spring.datasource.url`, `spring.jpa.*`, `mybatis.*` | déduire moteur de l'URL JDBC |
| `prisma/schema.prisma` → `datasource.provider` | `postgresql`, `mysql`, `sqlite`, `mongodb` |
| `sequelize`, `typeorm` config | dialect + driver |
| `psycopg2`, `sqlalchemy`, Django `DATABASES` | dialect |
| `go-pg`, `gorm`, `sqlx`, `pgx`, `mongo-go-driver` | driver |

- `port` : 5432 (PG), 3306 (MySQL), 27017 (Mongo), 1521 (Oracle), 1433 (SQL Server)…
- `consumed_via` : ORM/driver utilisé (`JPA / Hibernate`, `Prisma`, `pg`, `psycopg2 + SQLAlchemy`, etc.)
- `url` : laisser le placeholder d'env (`${POSTGRES_URL}`) — ne jamais révéler une URL de prod réelle

#### `tables[]` — schéma logique de la base

Pour chaque composant `db`, lister les **tables / collections** gérées. Permet de valider les références `endpoints[].data_access[].resource` et de détecter les tables non utilisées (cross-cutting analysis).

```json
"tables": [
  { "name": "items",           "purpose": "Catalogue produits" },
  { "name": "item_categories", "purpose": "Hiérarchie des catégories" },
  { "name": "audit_log",       "purpose": "Trace des modifications", "note": "Volume > 10M lignes, partitionnement mensuel" }
]
```

**Sources** :
- **JPA** : `@Entity` + `@Table(name="...")` ; sans `@Table`, déduire du nom de classe en `snake_case`
- **Prisma** : `prisma/schema.prisma` → chaque `model` → table
- **TypeORM/Sequelize** : `@Entity` ou `sequelize.define(name, ...)`
- **MyBatis** : tables référencées dans `<select|insert|update|delete>` des `*Mapper.xml`
- **Flyway/Liquibase** : SQL migrations → `CREATE TABLE` / `ALTER TABLE`
- **MongoDB** : noms de collections déclarés dans les modèles

`name` doit matcher `^[a-zA-Z_][a-zA-Z0-9_]*$`. `purpose` : 1 phrase métier (déduire du nom de l'entité et de ses champs). `note` : volume, partitionnement, RGPD, etc.

### `cache`
| Source | Tech |
|---|---|
| `spring-boot-starter-data-redis`, `RedisTemplate`, `@Cacheable` | Redis |
| `ioredis`, `node-redis`, `cachemanager` | Redis (Node) |
| `memcached`, `pymemcache` | Memcached |
| `hazelcast`, `infinispan` | grid in-memory |

- `cached_data[]` : une entrée par `@Cacheable("nom")` ou par pattern de clé observé. `key_pattern` (ex: `"session:*"`, `"user:{id}:perms"`), `ttl` (`"1h"`, `"24h"`, `"no-expiry"`), `purpose` (objet métier mis en cache).

### `queue` (point-à-point)
- AWS SQS, Google Pub/Sub (Pull subscription), Azure Service Bus → SDK détecté
- BullMQ, Bee-Queue, `node-cron` jobs → workers Node

### `mq` (pub/sub ou streaming)
| Source | Tech |
|---|---|
| `@KafkaListener`, `KafkaTemplate`, `spring.kafka.*` | Kafka |
| `@RabbitListener`, `RabbitTemplate`, `amqp` | RabbitMQ |
| `nats`, `eventbridge` SDK | NATS, EventBridge |

- Préciser les **topics** ou **queues** détectés dans `note` ou `description`.

### `batch`
- Spring Batch (`@EnableBatchProcessing`, `JobBuilder`, `StepBuilder`)
- Quartz (`@Scheduled(cron=...)`), `node-cron`, Celery beat
- Préciser la périodicité dans `description`.

### `etl`
- Spring Cloud Data Flow, Airflow DAGs (`@dag`, `DAG(...)`), dbt models, Dagster
- `type: "etl"`, `layer: "Data"`

## Validation
- Dédup par `id`.
- `type` : enum `db|cache|queue|mq|batch|etl`
- `cached_data[]` : dédup par `key_pattern`
- `port` : entier 1-65535

## Merge
- `id`, `label`, `note`, `cached_data[].purpose` → preserve-manual
- `technology`, `port`, `consumed_via` → replace
- `url` → preserve-manual (souvent placeholder rédigé à la main)
- `cached_data[]` → dédup par `key_pattern` + merge champ par champ
