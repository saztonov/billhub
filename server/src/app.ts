import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { sql } from 'drizzle-orm';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { config, isSupabaseNeeded } from './config.js';
import { toCamelCase } from './utils/caseTransform.js';
import { FASTIFY_REDACT_PATHS } from './services/observability/logger.js';
import { assertEnvStartup, assertRuntimeStartup } from './services/observability/startup-checks.js';
import { DEFAULT_MIGRATIONS_DIR, loadMigrationFiles } from './cli/migrate.js';
import {
  NotFoundError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from './repositories/index.js';

/** Плагины инфраструктуры */
import databasePlugin from './plugins/database.js';
import databaseDrizzlePlugin from './plugins/database-drizzle.js';
import s3Plugin from './plugins/s3.js';
import redisPlugin from './plugins/redis.js';
import queuesPlugin from './plugins/queues.js';
import maintenancePlugin from './plugins/maintenance.js';
import repositoriesPlugin from './plugins/repositories.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';

/** Маршруты */
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import uploadProgressRoutes from './routes/upload-progress.js';
import referenceRoutes from './routes/references/index.js';
import settingsRoutes from './routes/settings.js';
import fieldOptionRoutes from './routes/field-options.js';
import userRoutes from './routes/users.js';

/** Маршруты бизнес-логики */
import paymentRequestRoutes from './routes/payment-requests.js';
import paymentRequestExtraRoutes from './routes/payment-requests-extra.js';
import contractRequestRoutes from './routes/contract-requests.js';
import approvalRoutes from './routes/approvals.js';
import approvalExtraRoutes from './routes/approval-extra.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import notificationActionRoutes from './routes/notification-actions.js';
import assignmentRoutes from './routes/assignments.js';
import omtsRpRoutes from './routes/omts-rp.js';
import paymentRoutes from './routes/payments.js';
import errorLogRoutes from './routes/error-logs.js';
import materialRoutes from './routes/materials.js';
import ocrRoutes from './routes/ocr.js';
import fileProxyRoutes from './routes/file-proxy.js';
import foundingDocumentRoutes from './routes/founding-documents.js';

/** Импорт типов для расширения FastifyInstance */
import './types/index.js';

/**
 * Опции построения приложения.
 *
 * `skipInfra` пропускает регистрацию плагинов database/s3/redis/queues и инфра-зависимых
 * маршрутов. Используется в unit-тестах для проверки только утилитных эндпоинтов
 * (например, `/api/health`).
 *
 * `skipRoutes` пропускает регистрацию доменных роутов (auth, files, references и т.д.).
 * Используется, когда тесту нужны только инфра-плагины с моками.
 */
export interface CreateAppOptions {
  /** Пропустить регистрацию database/s3/redis/queues плагинов */
  skipInfra?: boolean;
  /** Пропустить регистрацию бизнес-роутов (оставит только health) */
  skipRoutes?: boolean;
  /** Опциональная Pino-конфигурация (по умолчанию — config.nodeEnv-зависимая) */
  logger?: FastifyServerOptions['logger'];
}

/**
 * Создаёт Fastify-инстанс с зарегистрированными плагинами и маршрутами.
 * НЕ запускает listen — это отдельный шаг (см. start()).
 *
 * Эта функция — main entry для тестов: позволяет вызвать `app.inject(...)` без
 * прослушивания порта.
 */
export async function createApp(opts: CreateAppOptions = {}): Promise<FastifyInstance> {
  const { skipInfra = false, skipRoutes = false, logger } = opts;

  const fastify = Fastify({
    logger: logger ?? {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      /**
       * Скрываем секреты и ПДн из логов (Iteration 7, observability §20).
       * Единый список путей — services/observability/logger.ts (FASTIFY_REDACT_PATHS):
       * auth-секреты, presigned-URL, OCR-поля (ocr_response/recognized_text/material_name).
       */
      redact: { paths: FASTIFY_REDACT_PATHS, censor: '[Redacted]' },
      transport:
        config.nodeEnv !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  /** Разрешаем пустое тело при Content-Type: application/json */
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const str = (body as string).trim();
      if (!str) {
        done(null, null);
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  /** Парсер для бинарных данных (чанки файлов) — не буферизуем, читаем как stream в роуте */
  fastify.addContentTypeParser('application/octet-stream', (_request, _payload, done) => {
    done(null);
  });

  /** 1. CORS */
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  /** 2. Куки */
  await fastify.register(cookie);

  /** 2.5. CSRF (double-submit). No-op в supabase-bridge; активна в standalone. */
  await fastify.register(csrfPlugin);

  /** 3. Заголовки безопасности */
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  });

  /** 4. Ограничение частоты запросов */
  await fastify.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
  });

  /** Глобальный хук: конвертация ключей ответа в camelCase */
  fastify.addHook('preSerialization', async (_request, _reply, payload) => {
    if (payload && typeof payload === 'object') {
      return toCamelCase(payload);
    }
    return payload;
  });

  /**
   * Централизованный обработчик ошибок.
   * Доменные ошибки репозиториев (Strangler Fig) и zod-валидация маппятся на HTTP-коды,
   * чтобы роуты, переведённые на fastify.repos, оставались тонкими (Iteration 5).
   */
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    // Ошибка валидации схемы Fastify (params/querystring/body через JSON-schema)
    if (error.validation) {
      return reply.status(400).send({ error: error.message });
    }
    // Ошибка zod-валидации тела запроса (.parse())
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Ошибка валидации', details: error.issues });
    }
    if (error instanceof ValidationError) {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof ForbiddenError) {
      return reply.status(403).send({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    if (
      error instanceof UniqueConstraintError ||
      error instanceof ForeignKeyConstraintError ||
      error instanceof ConflictError
    ) {
      return reply.status(409).send({ error: error.message });
    }
    // Явный клиентский статус (rate-limit 429 и т.п.)
    const statusCode = error.statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: error.message });
    }
    // Прочее — внутренняя ошибка (детали только в лог, не клиенту)
    request.log.error(error);
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  /** Плагины инфраструктуры */
  if (!skipInfra) {
    // Supabase-клиент регистрируется только когда он реально нужен (supabase-bridge /
    // DB_PROVIDER=supabase). В standalone+drizzle (Этап 1) плагин не поднимается — SUPABASE_* не нужны.
    if (isSupabaseNeeded(process.env)) {
      await fastify.register(databasePlugin);
    }
    await fastify.register(databaseDrizzlePlugin);
    await fastify.register(s3Plugin);
    await fastify.register(redisPlugin);
    await fastify.register(queuesPlugin);
    await fastify.register(repositoriesPlugin);
    // Фоновые задачи (outbox-диспетчер + retention + мониторы) — Iteration 7. No-op без Drizzle.
    await fastify.register(maintenancePlugin);
  }

  /**
   * Auth-сервисы (Iteration 6). Регистрируются всегда: используют fastify.db (Drizzle) если он
   * есть (production standalone), иначе in-memory хранилища (герметичные тесты без Docker).
   */
  await fastify.register(authPlugin);

  /** Маршруты (health всегда; остальные — если не skipRoutes) */
  await fastify.register(healthRoutes);

  if (!skipRoutes) {
    await fastify.register(authRoutes);
    await fastify.register(fileRoutes);
    await fastify.register(uploadProgressRoutes);
    await fastify.register(referenceRoutes);
    await fastify.register(settingsRoutes, { prefix: '/api/settings' });
    await fastify.register(fieldOptionRoutes, { prefix: '/api/references/field-options' });
    await fastify.register(userRoutes, { prefix: '/api/users' });

    /** Маршруты бизнес-логики */
    await fastify.register(paymentRequestRoutes);
    await fastify.register(paymentRequestExtraRoutes);
    await fastify.register(contractRequestRoutes);
    await fastify.register(approvalRoutes);
    await fastify.register(approvalExtraRoutes);
    await fastify.register(commentRoutes);
    await fastify.register(notificationRoutes);
    await fastify.register(notificationActionRoutes);
    await fastify.register(assignmentRoutes);
    await fastify.register(omtsRpRoutes);
    await fastify.register(paymentRoutes);
    await fastify.register(errorLogRoutes);
    await fastify.register(materialRoutes);
    await fastify.register(ocrRoutes);
    await fastify.register(fileProxyRoutes);
    await fastify.register(foundingDocumentRoutes, { prefix: '/api/founding-documents' });
  }

  await fastify.ready();
  return fastify;
}

/** Runtime startup checks (production): расширения PG, применённая миграция, доступность S3. */
async function runRuntimeStartupChecks(fastify: FastifyInstance): Promise<void> {
  const files = loadMigrationFiles(DEFAULT_MIGRATIONS_DIR);
  const expected = files.length ? Math.max(...files.map((f) => f.version)) : 0;
  await assertRuntimeStartup(process.env, {
    hasDb: !!fastify.db,
    queryExtensions: async () => {
      const res = await fastify.db!.execute(sql`select extname from pg_extension`);
      return (res as unknown as Array<{ extname: string }>).map((r) => r.extname);
    },
    queryAppliedMigration: async () => {
      const res = await fastify.db!.execute(
        sql`select max(version)::int as v from public._migrations`,
      );
      return (res as unknown as Array<{ v: number | null }>)[0]?.v ?? null;
    },
    expectedMigration: expected,
    headBucket: async () => {
      await fastify.s3Client.send(new HeadBucketCommand({ Bucket: fastify.s3Bucket }));
    },
  });
}

/**
 * Запускает сервер на configured port.
 * Тонкая обёртка над createApp + listen.
 */
export async function start(): Promise<void> {
  // 1. Быстрый fail на env-проблемах (production): обязательные env, placeholder, sslmode, dev-флаги.
  assertEnvStartup(process.env);

  const fastify = await createApp();
  try {
    // 2. Runtime-проверки (production): расширения PG, миграция == ожидаемой, S3 reachable.
    if (config.nodeEnv === 'production') {
      await runRuntimeStartupChecks(fastify);
    }
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(`Сервер запущен на http://0.0.0.0:${config.port} (${config.nodeEnv})`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
