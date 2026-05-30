/**
 * Setup для бэкэнд-тестов.
 * Подменяет минимально необходимые env-переменные тестовыми значениями,
 * чтобы config.ts инициализировался без ошибок.
 */

// Чтобы не валились startup checks в config.ts
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '0';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret';
process.env.STORAGE_PROVIDER ??= 'cloudru';
process.env.S3_ENDPOINT ??= 'https://test.s3.local';
process.env.S3_REGION ??= 'ru-test';
process.env.S3_ACCESS_KEY ??= 'test-s3-key';
process.env.S3_SECRET_KEY ??= 'test-s3-secret';
process.env.S3_BUCKET ??= 'test-bucket';
process.env.OPENROUTER_API_KEY ??= 'test-or-key';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MAX_FILE_SIZE_MB ??= '100';
