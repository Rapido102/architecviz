import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MISSING = 'À confirmer';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
function readJson<T = unknown>(path: string): T | null {
  const raw = readIfExists(path);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
function stripVersion(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, '').trim();
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'out', 'vendor', '__pycache__', '.venv']);
function findFiles(dir: string, test: (name: string) => boolean, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (cur: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(cur); } catch { return; }
    for (const e of entries) {
      const full = join(cur, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(e)) walk(full, depth + 1); }
      else if (test(e)) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

interface Signals {
  deps: Record<string, string>;
  buildFile: string;
  yml: string;
  py: string;
  goMod: string;
  prisma: string;
}

function gatherSignals(projectPath: string): Signals {
  const pkg = readJson<PackageJson>(resolve(projectPath, 'package.json'));
  const deps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};
  const buildFile =
    (readIfExists(resolve(projectPath, 'pom.xml')) ?? '') +
    (readIfExists(resolve(projectPath, 'build.gradle')) ?? '') +
    (readIfExists(resolve(projectPath, 'build.gradle.kts')) ?? '');
  const ymlFiles = findFiles(resolve(projectPath, 'src', 'main', 'resources'), (n) => /^application.*\.(ya?ml|properties)$/.test(n));
  const yml = ymlFiles.map((f) => readIfExists(f) ?? '').join('\n');
  const py = (readIfExists(resolve(projectPath, 'pyproject.toml')) ?? '') + (readIfExists(resolve(projectPath, 'requirements.txt')) ?? '');
  const goMod = readIfExists(resolve(projectPath, 'go.mod')) ?? '';
  const prisma = readIfExists(resolve(projectPath, 'prisma', 'schema.prisma')) ?? '';
  return { deps, buildFile, yml, py, goMod, prisma };
}

function dbFromJdbc(url: string): { tech: string; port: number; id: string } | null {
  const u = url.toLowerCase();
  if (u.includes('postgresql')) return { tech: 'PostgreSQL', port: 5432, id: 'db_postgres' };
  if (u.includes('mysql') || u.includes('mariadb')) return { tech: 'MySQL', port: 3306, id: 'db_mysql' };
  if (u.includes('oracle')) return { tech: 'Oracle', port: 1521, id: 'db_oracle' };
  if (u.includes('sqlserver') || u.includes('mssql')) return { tech: 'SQL Server', port: 1433, id: 'db_sqlserver' };
  if (u.includes('h2')) return { tech: 'H2', port: 0, id: 'db_h2' };
  if (u.includes('mongodb')) return { tech: 'MongoDB', port: 27017, id: 'db_mongo' };
  return null;
}

export function extractDataComponents(projectPath: string): {
  fragment: Record<string, unknown>[];
  detected: boolean;
  notes: string[];
} {
  const s = gatherSignals(projectPath);
  const components: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (c: Record<string, unknown>) => {
    if (seen.has(c.id as string)) return;
    seen.add(c.id as string);
    components.push(c);
  };

  // ── DB ──────────────────────────────────────────────────────────────────
  // Match only datasource/r2dbc URLs — NOT bare `url:` (which also matches Feign client URLs).
  const jdbcUrl =
    s.yml.match(/(?:spring\.datasource\.url|datasource\.url|spring\.r2dbc\.url|r2dbc\.url)\s*[:=]\s*["']?([^"'\s]+)/i)?.[1] ??
    s.yml.match(/jdbc:[a-z0-9]+:[^\s"']+/i)?.[0];
  if (jdbcUrl) {
    const db = dbFromJdbc(jdbcUrl);
    if (db) {
      const consumedVia = /jpa|hibernate/i.test(s.buildFile) ? 'JPA / Hibernate' : /mybatis/i.test(s.buildFile) ? 'MyBatis' : 'Spring JDBC';
      push({ id: db.id, label: db.tech, type: 'db', layer: 'Data', technology: db.tech, url: '${DATASOURCE_URL}', ...(db.port ? { port: db.port } : {}), consumed_via: consumedVia });
    }
  } else if (s.buildFile) {
    // No JDBC URL in config (env/cloud-config) — fall back to detecting the JDBC driver dependency.
    const consumedVia = /jpa|hibernate/i.test(s.buildFile) ? 'JPA / Hibernate' : /mybatis/i.test(s.buildFile) ? 'MyBatis' : 'Spring JDBC';
    const driver: { re: RegExp; tech: string; port: number; id: string }[] = [
      { re: /mysql-connector|mariadb-java-client/i, tech: 'MySQL', port: 3306, id: 'db_mysql' },
      { re: /org\.postgresql|postgresql/i, tech: 'PostgreSQL', port: 5432, id: 'db_postgres' },
      { re: /ojdbc|oracle/i, tech: 'Oracle', port: 1521, id: 'db_oracle' },
      { re: /mssql-jdbc|sqlserver/i, tech: 'SQL Server', port: 1433, id: 'db_sqlserver' },
      { re: /com\.h2database|h2database/i, tech: 'H2', port: 0, id: 'db_h2' },
      { re: /mongodb-driver|spring-boot-starter-data-mongodb/i, tech: 'MongoDB', port: 27017, id: 'db_mongo' },
    ];
    for (const d of driver) {
      if (d.re.test(s.buildFile)) {
        push({ id: d.id, label: d.tech, type: 'db', layer: 'Data', technology: d.tech, url: '${DATASOURCE_URL}', ...(d.port ? { port: d.port } : {}), consumed_via: consumedVia });
        break;
      }
    }
  }
  if (s.prisma) {
    const provider = s.prisma.match(/provider\s*=\s*["']([^"']+)["']/)?.[1] ?? '';
    const map: Record<string, { tech: string; port: number; id: string }> = {
      postgresql: { tech: 'PostgreSQL', port: 5432, id: 'db_postgres' },
      mysql: { tech: 'MySQL', port: 3306, id: 'db_mysql' },
      mongodb: { tech: 'MongoDB', port: 27017, id: 'db_mongo' },
      sqlite: { tech: 'SQLite', port: 0, id: 'db_sqlite' },
    };
    const d = map[provider];
    if (d) push({ id: d.id, label: d.tech, type: 'db', layer: 'Data', technology: d.tech, url: '${DATABASE_URL}', ...(d.port ? { port: d.port } : {}), consumed_via: 'Prisma' });
  }
  // Node ORMs / drivers
  if (s.deps['pg'] || s.deps['postgres']) push({ id: 'db_postgres', label: 'PostgreSQL', type: 'db', layer: 'Data', technology: 'PostgreSQL', url: '${DATABASE_URL}', port: 5432, consumed_via: s.deps['typeorm'] ? 'TypeORM' : s.deps['sequelize'] ? 'Sequelize' : 'pg' });
  if (s.deps['mysql'] || s.deps['mysql2']) push({ id: 'db_mysql', label: 'MySQL', type: 'db', layer: 'Data', technology: 'MySQL', url: '${DATABASE_URL}', port: 3306, consumed_via: s.deps['typeorm'] ? 'TypeORM' : s.deps['sequelize'] ? 'Sequelize' : 'mysql2' });
  if (s.deps['mongodb'] || s.deps['mongoose']) push({ id: 'db_mongo', label: 'MongoDB', type: 'db', layer: 'Data', technology: 'MongoDB', url: '${MONGO_URL}', port: 27017, consumed_via: s.deps['mongoose'] ? 'Mongoose' : 'mongodb' });
  // Python
  if (/psycopg2|asyncpg/i.test(s.py)) push({ id: 'db_postgres', label: 'PostgreSQL', type: 'db', layer: 'Data', technology: 'PostgreSQL', url: '${DATABASE_URL}', port: 5432, consumed_via: /sqlalchemy/i.test(s.py) ? 'SQLAlchemy' : 'psycopg2' });
  if (/pymongo|motor/i.test(s.py)) push({ id: 'db_mongo', label: 'MongoDB', type: 'db', layer: 'Data', technology: 'MongoDB', url: '${MONGO_URL}', port: 27017, consumed_via: 'pymongo' });
  // Go
  if (/gorm|pgx|lib\/pq/i.test(s.goMod)) push({ id: 'db_postgres', label: 'PostgreSQL', type: 'db', layer: 'Data', technology: 'PostgreSQL', url: '${DATABASE_URL}', port: 5432, consumed_via: /gorm/i.test(s.goMod) ? 'GORM' : 'pgx' });

  // ── Cache ─────────────────────────────────────────────────────────────────
  const redisHost = s.yml.match(/(?:spring\.data\.redis\.host|spring\.redis\.host|redis\.host)\s*[:=]\s*["']?([^"'\s]+)/i)?.[1];
  if (/spring-boot-starter-data-redis|lettuce|jedis/i.test(s.buildFile) || redisHost || s.deps['ioredis'] || s.deps['redis'] || /(^|\s)redis(\s|=|>)/i.test(s.py)) {
    push({ id: 'cache_redis', label: 'Redis Cache', type: 'cache', layer: 'Data', technology: 'Redis', url: redisHost ? `redis://${redisHost}:6379` : '${REDIS_URL}', port: 6379, consumed_via: /spring/i.test(s.buildFile) ? 'Spring Data Redis' : s.deps['ioredis'] ? 'ioredis' : 'redis', cached_data: [] });
  }
  if (s.deps['memcached'] || /pymemcache/i.test(s.py)) {
    push({ id: 'cache_memcached', label: 'Memcached', type: 'cache', layer: 'Data', technology: 'Memcached', url: '${MEMCACHED_URL}', port: 11211, consumed_via: MISSING });
  }

  // ── Message brokers / queues ──────────────────────────────────────────────
  const kafkaBootstrap = s.yml.match(/(?:spring\.kafka\.bootstrap-servers|kafka\.bootstrap)\s*[:=]\s*["']?([^"'\s]+)/i)?.[1];
  if (/spring-kafka/i.test(s.buildFile) || kafkaBootstrap || s.deps['kafkajs'] || /confluent-kafka|aiokafka/i.test(s.py)) {
    push({ id: 'mq_kafka', label: 'Kafka', type: 'mq', layer: 'Data', technology: 'Apache Kafka', url: kafkaBootstrap ?? '${KAFKA_BOOTSTRAP}', consumed_via: /spring/i.test(s.buildFile) ? 'Spring Kafka' : s.deps['kafkajs'] ? 'KafkaJS' : MISSING });
  }
  if (/spring-rabbit|spring-amqp/i.test(s.buildFile) || s.deps['amqplib'] || /pika|aio-pika/i.test(s.py)) {
    push({ id: 'mq_rabbitmq', label: 'RabbitMQ', type: 'mq', layer: 'Data', technology: 'RabbitMQ', url: '${RABBITMQ_URL}', port: 5672, consumed_via: /spring/i.test(s.buildFile) ? 'Spring AMQP' : s.deps['amqplib'] ? 'amqplib' : MISSING });
  }
  if (s.deps['bullmq'] || s.deps['bull']) {
    push({ id: 'queue_bullmq', label: 'BullMQ', type: 'queue', layer: 'Data', technology: 'BullMQ + Redis', url: '${REDIS_URL}', consumed_via: 'BullMQ Worker' });
  }
  if (/@aws-sdk\/client-sqs/.test(JSON.stringify(s.deps)) || /boto3/i.test(s.py)) {
    push({ id: 'queue_sqs', label: 'AWS SQS', type: 'queue', layer: 'Data', technology: 'AWS SQS', url: '${SQS_QUEUE_URL}', consumed_via: MISSING });
  }

  if (components.length === 0) {
    notes.push('Aucun composant data détecté (db/cache/mq/queue) dans les deps/config.');
  } else {
    notes.push(`${components.length} composant(s) data détecté(s) : ${components.map((c) => c.id).join(', ')}`);
    notes.push('cached_data[] et tables[] non remplis par l\'extracteur — compléter via Claude (prompts/sections/components-data.md).');
  }

  return { fragment: components, detected: components.length > 0, notes };
}
