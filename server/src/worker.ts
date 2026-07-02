/**
 * Точка входа worker-процесса (Iteration 8 — разделение API/worker).
 *
 * Отдельный контейнер обрабатывает BullMQ-задачи (file-processing, OCR), пока API-контейнер
 * только ставит их в очередь (RUN_WORKERS=false). Это второй процесс в connection budget
 * (ADR-0005: 1 VPS × 2 процесса × pool.max=10 + reserve 5 = 25; conn_limit billhub_runtime=30).
 *
 * Процесс НЕ поднимает API-роуты. Поднимает только:
 *   - Drizzle-пул (для записи результатов задач в jobs_log, при DB_PROVIDER=drizzle);
 *   - оба воркера с concurrency из OCR_CONCURRENCY / FILE_PROCESSING_CONCURRENCY;
 *   - минимальный HTTP /health/live для healthcheck контейнера.
 *
 * Backend stateless (принцип 7): состояние — в Redis (BullMQ) и БД, не на диске.
 */
import { createServer } from 'node:http';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './db/schema/index.js';
import { pgNumericAsNumberTypes } from './db/pg-types.js';
import { config } from './config.js';
import { resolveDbProvider } from './plugins/repositories.js';
import { createFileProcessingWorker } from './queues/fileProcessingWorker.js';
import { createOcrWorker } from './queues/ocrWorker.js';
import { fileProcessingQueue, ocrQueue } from './queues/index.js';
import { DrizzleJobsLogRepository } from './repositories/drizzle/jobs-log.drizzle.js';
import type { JobsLogRepository } from './repositories/jobs-log.repository.js';
import type { BillhubDatabase } from './plugins/database-drizzle.js';
import { createObservabilityLogger } from './services/observability/logger.js';

const logger = createObservabilityLogger('worker-main');

async function main(): Promise<void> {
  // jobs_log (Iteration 7) — только при Drizzle. postgres.js-пул закрываем при остановке.
  let pgClient: ReturnType<typeof postgres> | undefined;
  let db: BillhubDatabase | undefined;
  let jobsLog: JobsLogRepository | undefined;

  if (resolveDbProvider(process.env) === 'drizzle' && config.databaseUrl) {
    const max =
      Number.isFinite(config.databasePoolMax) && config.databasePoolMax > 0
        ? config.databasePoolMax
        : 10;
    // prepare: false — transaction-mode пул Yandex Managed PG (:6432) несовместим с prepared statements.
    pgClient = postgres(config.databaseUrl, {
      max,
      prepare: false,
      onnotice: () => {},
      types: pgNumericAsNumberTypes,
    });
    db = drizzle(pgClient, { schema });
    jobsLog = new DrizzleJobsLogRepository(db);
    logger.info({ poolMax: max }, 'worker: Drizzle-пул для jobs_log инициализирован');
  } else {
    logger.warn('worker: DB_PROVIDER!=drizzle или нет DATABASE_URL — jobs_log отключён');
  }

  const fileWorker = createFileProcessingWorker({ jobsLog, db });
  const ocrWorker = createOcrWorker({ jobsLog, db });
  logger.info(
    { ocrConcurrency: config.ocrConcurrency, fileConcurrency: config.fileProcessingConcurrency },
    'worker: BullMQ воркеры запущены',
  );

  // Минимальный liveness-эндпоинт для healthcheck контейнера (порт config.port).
  const health = createServer((req, res) => {
    if (req.url === '/health/live' || req.url === '/api/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', role: 'worker', uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  health.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port }, 'worker: health-сервер слушает /health/live');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker: завершение…');
    health.close();
    await fileWorker.close();
    await ocrWorker.close();
    await fileProcessingQueue.close();
    await ocrQueue.close();
    if (pgClient) await pgClient.end({ timeout: 5 });
    logger.info('worker: остановлен');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'worker: фатальная ошибка при старте');
  process.exit(1);
});
