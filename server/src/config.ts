import 'dotenv/config';

interface Config {
  port: number;
  corsOrigin: string;
  nodeEnv: string;

  /** Supabase */
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;

  /** S3-совместимое хранилище (Cloud.ru) */
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;

  /** Провайдер хранилища */
  storageProvider: 'cloudru' | 'cloudflare';

  /** Cloudflare R2 (альтернативный провайдер) */
  r2Endpoint: string;
  r2AccessKey: string;
  r2SecretKey: string;
  r2Bucket: string;

  /** OpenRouter */
  openrouterApiKey: string;

  /** Redis */
  redisUrl: string;

  /** Лимит размера файла (МБ) */
  maxFileSizeMb: number;

  /** Drizzle / PostgreSQL (активны при DB_PROVIDER=drizzle; см. database-drizzle плагин) */
  databaseUrl: string;
  databaseMigrationUrl: string;
  databasePoolMax: number;

  /**
   * Режим аутентификации (Iteration 6). Это ОБЫЧНЫЙ feature-флаг, НЕ startup-инвариант
   * (в отличие от DB_PROVIDER): план не объявляет AUTH_MODE инвариантом.
   *   supabase-bridge — legacy-путь (Supabase Auth), default для старого окружения.
   *   standalone      — собственный стек (раздел 13): bcrypt + access JWT + refresh rotation.
   */
  authMode: 'supabase-bridge' | 'standalone';

  /** Standalone JWT (HS256). issuer/audience проверяются в authenticate. */
  authJwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTtlSeconds: number;
  refreshTtlSeconds: number;

  /** Длина grace-window (мс) при ротации refresh-токена (параллельные вкладки). */
  refreshGraceMs: number;

  /** Секрет для double-submit CSRF-cookie. */
  csrfSecret: string;

  /** Ключ HMAC для псевдонимизации email в audit_log и ключах rate-limit. */
  auditHmacKey: string;
}

/** Получение переменной окружения с значением по умолчанию */
function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Переменная окружения ${key} не задана`);
  }
  return value;
}

/** Получение необязательной переменной окружения */
function envOptional(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue;
}

/** Валидация обязательных переменных при старте */
function validateRequired(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Отсутствуют обязательные переменные окружения: ${missing.join(', ')}`);
  }
}

validateRequired(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET']);

export const config: Config = {
  port: parseInt(envOptional('PORT', '3000'), 10),
  corsOrigin: envOptional('CORS_ORIGIN', 'http://localhost:5173'),
  nodeEnv: envOptional('NODE_ENV', 'development'),

  supabaseUrl: env('SUPABASE_URL'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseJwtSecret: env('SUPABASE_JWT_SECRET'),

  s3Endpoint: envOptional('S3_ENDPOINT'),
  s3Region: envOptional('S3_REGION', 'ru-1'),
  s3AccessKey: envOptional('S3_ACCESS_KEY'),
  s3SecretKey: envOptional('S3_SECRET_KEY'),
  s3Bucket: envOptional('S3_BUCKET'),

  storageProvider: envOptional('STORAGE_PROVIDER', 'cloudru') as Config['storageProvider'],

  r2Endpoint: envOptional('R2_ENDPOINT'),
  r2AccessKey: envOptional('R2_ACCESS_KEY'),
  r2SecretKey: envOptional('R2_SECRET_KEY'),
  r2Bucket: envOptional('R2_BUCKET'),

  openrouterApiKey: envOptional('OPENROUTER_API_KEY'),

  redisUrl: envOptional('REDIS_URL', 'redis://localhost:6379'),

  maxFileSizeMb: parseInt(envOptional('MAX_FILE_SIZE_MB', '100'), 10),

  databaseUrl: envOptional('DATABASE_URL'),
  databaseMigrationUrl: envOptional('DATABASE_MIGRATION_URL'),
  databasePoolMax: parseInt(envOptional('DATABASE_POOL_MAX', '10'), 10),

  authMode: envOptional('AUTH_MODE', 'supabase-bridge') as Config['authMode'],
  authJwtSecret: envOptional('AUTH_JWT_SECRET', 'dev-insecure-auth-jwt-secret-change-me'),
  jwtIssuer: envOptional('JWT_ISSUER', 'BillHub'),
  jwtAudience: envOptional('JWT_AUDIENCE', 'billhub'),
  jwtAccessTtlSeconds: parseInt(envOptional('JWT_ACCESS_TTL_SECONDS', '900'), 10),
  refreshTtlSeconds: parseInt(envOptional('REFRESH_TTL_SECONDS', '2592000'), 10),
  refreshGraceMs: parseInt(envOptional('REFRESH_GRACE_MS', '5000'), 10),
  csrfSecret: envOptional('CSRF_SECRET', 'dev-insecure-csrf-secret-change-me'),
  auditHmacKey: envOptional('AUDIT_HMAC_KEY', 'dev-insecure-audit-hmac-key-change-me'),
};
