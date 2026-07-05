/**
 * Production startup checks (план Iteration 7, §7; стандарт v3 §25 — сокращённый для Этапа 1).
 *
 * Разделены на чистые env-проверки (без IO, unit-тестируемы) и runtime-проверки (PG-расширения,
 * применённая миграция, доступность S3 — выполняются в start() против живых зависимостей).
 *
 * В production отсутствие требований = отказ старта (fail-fast). Вне production — проверки
 * не запускаются (dev/тест работают на placeholder-значениях).
 */

export type StartupEnv = Record<string, string | undefined>;

/** Обязательные переменные окружения в production. */
export const REQUIRED_PROD_ENV: string[] = [
  'DATABASE_URL',
  'AUTH_JWT_SECRET',
  'CSRF_SECRET',
  'AUDIT_HMAC_KEY',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
];

/** Supabase-переменные — обязательны только в legacy-режимах (supabase-bridge / DB_PROVIDER=supabase). */
export const SUPABASE_ENV_KEYS: string[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
];

function supabaseNeeded(env: StartupEnv): boolean {
  const authMode = env.AUTH_MODE ?? 'supabase-bridge';
  const dbProvider = env.DB_PROVIDER ?? 'drizzle';
  return authMode === 'supabase-bridge' || dbProvider === 'supabase';
}

/** Обязательные переменные с учётом режима: в standalone+drizzle SUPABASE_* исключаются. */
export function requiredProdEnv(env: StartupEnv): string[] {
  return supabaseNeeded(env)
    ? REQUIRED_PROD_ENV
    : REQUIRED_PROD_ENV.filter((k) => !SUPABASE_ENV_KEYS.includes(k));
}

/** Переменные, проверяемые на placeholder-значения. */
export const PLACEHOLDER_CHECK_KEYS: string[] = [
  'DATABASE_URL',
  'AUTH_JWT_SECRET',
  'CSRF_SECRET',
  'AUDIT_HMAC_KEY',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
];

/** Подстроки-маркеры placeholder/небезопасных значений. */
export const PLACEHOLDER_SUBSTRINGS: string[] = [
  'change_me',
  'changeme',
  'dev-insecure',
  'example.com',
  'localhost',
  'placeholder',
  'your-',
];

/** Требуемые расширения PostgreSQL. */
export const REQUIRED_PG_EXTENSIONS: string[] = ['pgcrypto', 'citext', 'pg_trgm'];

export function checkRequiredEnv(env: StartupEnv, keys: string[] = REQUIRED_PROD_ENV): string[] {
  return keys
    .filter((k) => !env[k] || env[k]!.trim() === '')
    .map((k) => `Отсутствует обязательная переменная окружения ${k}`);
}

export function checkNoPlaceholders(
  env: StartupEnv,
  keys: string[] = PLACEHOLDER_CHECK_KEYS,
): string[] {
  const problems: string[] = [];
  for (const k of keys) {
    const v = env[k];
    if (!v) continue;
    const low = v.toLowerCase();
    const hit = PLACEHOLDER_SUBSTRINGS.find((p) => low.includes(p));
    if (hit) problems.push(`Переменная ${k} содержит placeholder '${hit}'`);
  }
  return problems;
}

export function checkSslMode(databaseUrl: string | undefined): string[] {
  if (!databaseUrl) return [];
  return /sslmode=verify-full/i.test(databaseUrl)
    ? []
    : ['DATABASE_URL должен содержать sslmode=verify-full (TLS до Yandex PG)'];
}

export function checkNoDevFlags(env: StartupEnv): string[] {
  const problems: string[] = [];
  if ((env.NODE_ENV ?? '') === 'production' && env.DEBUG && env.DEBUG.trim() !== '') {
    problems.push(`Dev-флаг DEBUG=${env.DEBUG} задан в production`);
  }
  return problems;
}

/**
 * C1: в production AUTH_MODE обязан быть `standalone` или `keycloak` (не молчаливый legacy
 * supabase-bridge). Ф4: keycloak-режим разрешён в проде; недостающие OIDC-переменные ловит
 * config.ts (validateRequired при isKeycloakMode), а доступность discovery/JWKS — readiness-проба.
 */
export function checkAuthModeInvariant(env: StartupEnv): string[] {
  if ((env.NODE_ENV ?? 'development') !== 'production') return [];
  const mode = env.AUTH_MODE ?? 'supabase-bridge';
  return mode === 'standalone' || mode === 'keycloak'
    ? []
    : [`В production обязателен AUTH_MODE=standalone или keycloak (получено: ${mode})`];
}

export function checkExtensions(
  present: string[],
  required: string[] = REQUIRED_PG_EXTENSIONS,
): string[] {
  const have = new Set(present);
  return required.filter((e) => !have.has(e)).map((e) => `Отсутствует расширение PostgreSQL: ${e}`);
}

export function checkAppliedMigration(applied: number | null, expected: number): string[] {
  if (applied === null) return ['Миграции не применены (таблица _migrations пуста)'];
  if (applied < expected) {
    return [
      `Применённая миграция ${applied} ниже ожидаемой ${expected} — БД не на последней схеме`,
    ];
  }
  return [];
}

/** Все чистые env-проверки (без IO). */
export function collectEnvStartupProblems(env: StartupEnv): string[] {
  return [
    ...checkRequiredEnv(env, requiredProdEnv(env)),
    ...checkNoPlaceholders(env),
    ...checkSslMode(env.DATABASE_URL),
    ...checkNoDevFlags(env),
    ...checkAuthModeInvariant(env),
  ];
}

export class StartupCheckError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Production startup checks провалены:\n - ${problems.join('\n - ')}`);
    this.name = 'StartupCheckError';
  }
}

/** Запускает env-проверки. В production бросает StartupCheckError при проблемах; иначе no-op. */
export function assertEnvStartup(env: StartupEnv): void {
  if ((env.NODE_ENV ?? 'development') !== 'production') return;
  const problems = collectEnvStartupProblems(env);
  if (problems.length > 0) throw new StartupCheckError(problems);
}

/** Зависимости runtime-проверок (IO инъектируется — модуль остаётся тестируемым без БД/S3). */
export interface RuntimeStartupDeps {
  hasDb: boolean;
  /** Список установленных расширений PG (extname). */
  queryExtensions: () => Promise<string[]>;
  /** Последняя применённая версия миграции (max(version) из _migrations), либо null. */
  queryAppliedMigration: () => Promise<number | null>;
  /** Ожидаемая последняя версия миграции по файлам. */
  expectedMigration: number;
  /** S3 HEAD bucket (бросает при недоступности). */
  headBucket: () => Promise<void>;
}

/** Собирает проблемы runtime-проверок (расширения PG, миграция, доступность S3). */
export async function collectRuntimeStartupProblems(deps: RuntimeStartupDeps): Promise<string[]> {
  const problems: string[] = [];
  if (!deps.hasDb) {
    problems.push('DB_PROVIDER!=drizzle в production: fastify.db не инициализирован');
  } else {
    try {
      problems.push(...checkExtensions(await deps.queryExtensions()));
    } catch (err) {
      problems.push(
        `Не удалось прочитать pg_extension: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      problems.push(
        ...checkAppliedMigration(await deps.queryAppliedMigration(), deps.expectedMigration),
      );
    } catch (err) {
      problems.push(
        `Не удалось прочитать _migrations: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    await deps.headBucket();
  } catch (err) {
    problems.push(`S3 HEAD bucket недоступен: ${err instanceof Error ? err.message : String(err)}`);
  }
  return problems;
}

/** В production бросает StartupCheckError при проблемах runtime-проверок. */
export async function assertRuntimeStartup(
  env: StartupEnv,
  deps: RuntimeStartupDeps,
): Promise<void> {
  if ((env.NODE_ENV ?? 'development') !== 'production') return;
  const problems = await collectRuntimeStartupProblems(deps);
  if (problems.length > 0) throw new StartupCheckError(problems);
}
