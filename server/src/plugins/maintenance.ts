/**
 * Плагин фоновых задач Этапа 1 (план Iteration 7, §7): outbox-диспетчер + retention + мониторы.
 * Все — BullMQ recurring job-scheduler-ы (Redis уже в стеке; отдельный systemd-timer не нужен).
 *
 * Активен только при наличии fastify.db (DB_PROVIDER=drizzle): все задачи работают с PostgreSQL.
 * В supabase-режиме (dev/rollback) — no-op. Под skipInfra (unit-тесты) не регистрируется вообще.
 *
 * Расписание:
 *   outbox-dispatch   — каждые 5с  (читает outbox, пишет в audit_log, помечает processed_at)
 *   db-conn-monitor   — каждые 30с (pg_stat_activity > 80% conn_limit → audit)
 *   dead-jobs-monitor — каждые 60с (jobs_log dead за час > 0 → audit)
 *   s3-error-monitor  — каждые 60с (S3 error-rate > 5%/мин → audit)
 *   retention         — ночью 03:00 (5 политик + обслуживание партиций audit_log)
 */
import fp from 'fastify-plugin';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { parseRedisUrl } from '../queues/index.js';
import { DrizzleOutboxRepository } from '../repositories/drizzle/outbox.drizzle.js';
import { DrizzleJobsLogRepository } from '../repositories/drizzle/jobs-log.drizzle.js';
import { DrizzleAuditLogRepository } from '../repositories/drizzle/audit-log.drizzle.js';
import { AuditLogService } from '../services/auth/audit-log.service.js';
import { OutboxService, auditLogOutboxHandler } from '../services/observability/outbox.service.js';
import { RetentionService } from '../services/observability/retention.service.js';
import { MonitorService } from '../services/observability/monitors.js';

export const MAINTENANCE_QUEUE = 'maintenance';

const JOB_OUTBOX = 'outbox-dispatch';
const JOB_RETENTION = 'retention';
const JOB_DB_CONN = 'db-conn-monitor';
const JOB_DEAD_JOBS = 'dead-jobs-monitor';
const JOB_S3_ERROR = 's3-error-monitor';

async function maintenancePlugin(fastify: FastifyInstance): Promise<void> {
  const db = fastify.db;
  if (!db) {
    fastify.log.info('maintenance: fastify.db отсутствует (не drizzle) — плагин неактивен (no-op)');
    return;
  }

  const audit = new AuditLogService({
    repo: new DrizzleAuditLogRepository(db),
    sink: fastify.log,
    hmacKey: config.auditHmacKey,
    onError: (err) => fastify.log.error({ err }, 'maintenance: audit_log запись не удалась'),
  });
  const outboxRepo = new DrizzleOutboxRepository(db);
  const jobsLogRepo = new DrizzleJobsLogRepository(db);

  const outboxService = new OutboxService({
    repo: outboxRepo,
    handler: auditLogOutboxHandler(audit),
    logger: fastify.log,
  });
  const retentionService = new RetentionService({
    db,
    outbox: outboxRepo,
    jobsLog: jobsLogRepo,
    audit,
  });
  const monitorService = new MonitorService({
    db,
    jobsLog: jobsLogRepo,
    audit,
    config: {
      runtimeUser: config.databaseRuntimeUser,
      connLimit: config.databaseConnLimit,
    },
  });

  const connection: ConnectionOptions = parseRedisUrl(config.redisUrl);
  const queue = new Queue(MAINTENANCE_QUEUE, {
    connection,
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
  });

  const processor = async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case JOB_OUTBOX:
        return outboxService.dispatch();
      case JOB_RETENTION:
        return retentionService.runAll();
      case JOB_DB_CONN:
        return monitorService.checkDbConnections();
      case JOB_DEAD_JOBS:
        return monitorService.checkDeadJobs();
      case JOB_S3_ERROR:
        return monitorService.checkS3ErrorRate();
      default:
        return undefined;
    }
  };

  const worker = new Worker(MAINTENANCE_QUEUE, processor, { connection, concurrency: 1 });
  worker.on('failed', (job, err) => {
    fastify.log.error({ job: job?.name, err: err.message }, 'maintenance: задача упала');
  });
  worker.on('error', (err) => {
    fastify.log.error({ err: err.message }, 'maintenance: ошибка воркера');
  });

  // Recurring job-scheduler-ы (идемпотентны: upsert по schedulerId).
  await queue.upsertJobScheduler(JOB_OUTBOX, { every: 5_000 }, { name: JOB_OUTBOX });
  await queue.upsertJobScheduler(JOB_DB_CONN, { every: 30_000 }, { name: JOB_DB_CONN });
  await queue.upsertJobScheduler(JOB_DEAD_JOBS, { every: 60_000 }, { name: JOB_DEAD_JOBS });
  await queue.upsertJobScheduler(JOB_S3_ERROR, { every: 60_000 }, { name: JOB_S3_ERROR });
  await queue.upsertJobScheduler(JOB_RETENTION, { pattern: '0 3 * * *' }, { name: JOB_RETENTION });

  fastify.log.info('maintenance: outbox-диспетчер + retention + мониторы запланированы');

  fastify.addHook('onClose', async () => {
    await worker.close();
    await queue.close();
    fastify.log.info('maintenance: воркер и очередь закрыты');
  });
}

export default fp(maintenancePlugin, {
  name: 'maintenance',
  dependencies: ['redis', 'database-drizzle'],
});
