/**
 * Интеграционные тесты observability-репозиториев на РЕАЛЬНОМ PostgreSQL (testcontainers).
 *
 * Миграция 0002 самодостаточна (outbox/audit_log/jobs_log не зависят от users), поэтому
 * накатывается на чистый контейнер БЕЗ bootstrap schema.sql — копируем только 0002 во временный
 * каталог и применяем собственным runner-ом (migrate.ts).
 *
 * Покрывают то, что in-memory не может: транзакционный rollback outbox (enqueueTx), маршрутизацию
 * по партициям audit_log, jobs_log. Требует Docker. Запуск: RUN_DOCKER_TESTS=1 vitest run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import { DEFAULT_MIGRATIONS_DIR, runMigrations } from '../../cli/migrate.js';
import { DrizzleOutboxRepository } from './outbox.drizzle.js';
import { DrizzleAuditLogRepository } from './audit-log.drizzle.js';
import { DrizzleJobsLogRepository } from './jobs-log.drizzle.js';
import {
  OutboxService,
  auditLogOutboxHandler,
} from '../../services/observability/outbox.service.js';
import { AuditLogService } from '../../services/auth/audit-log.service.js';
import { partitionName, monthStartUtc } from '../../services/observability/retention-policy.js';

const RUN = !!process.env.RUN_DOCKER_TESTS;
const AGG_ID = '00000000-0000-0000-0000-000000000aaa';

describe.skipIf(!RUN)('observability Drizzle (testcontainers PG)', () => {
  let container: { getConnectionUri(): string; stop(): Promise<unknown> };
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof schema>;
  let migDir: string;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();

    // Копируем только 0002 в temp-каталог и применяем (0002 не зависит от users).
    migDir = mkdtempSync(path.join(tmpdir(), 'obs-mig-'));
    copyFileSync(
      path.join(DEFAULT_MIGRATIONS_DIR, '0002_outbox_audit.sql'),
      path.join(migDir, '0002_outbox_audit.sql'),
    );
    await runMigrations({ databaseUrl: url, migrationsDir: migDir, logger: () => {} });

    client = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema });
  }, 120_000);

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await container?.stop();
    if (migDir) rmSync(migDir, { recursive: true, force: true });
  });

  it('outbox: enqueue → listUnprocessed → markProcessed', async () => {
    const repo = new DrizzleOutboxRepository(db);
    const id = await repo.enqueue({
      aggregateType: 'payment_request',
      aggregateId: AGG_ID,
      eventType: 'created',
      payload: { x: 1 },
    });
    const unprocessed = await repo.listUnprocessed(10);
    expect(unprocessed.some((r) => r.id === id)).toBe(true);
    const marked = await repo.markProcessed([id], new Date().toISOString());
    expect(marked).toBe(1);
    expect((await repo.listUnprocessed(10)).some((r) => r.id === id)).toBe(false);
  });

  it('outbox transactional: rollback транзакции откатывает и outbox-запись', async () => {
    const repo = new DrizzleOutboxRepository(db);
    const before = (await repo.listUnprocessed(1000)).length;
    await expect(
      db.transaction(async (tx) => {
        await repo.enqueueTx(tx, {
          aggregateType: 'payment_request',
          aggregateId: AGG_ID,
          eventType: 'rolled_back',
          payload: {},
        });
        throw new Error('boom — откат транзакции');
      }),
    ).rejects.toThrow('boom');
    const after = (await repo.listUnprocessed(1000)).length;
    expect(after).toBe(before); // запись откатилась вместе с транзакцией
  });

  it('диспетчер обрабатывает outbox → пишет в audit_log → processed_at', async () => {
    const outboxRepo = new DrizzleOutboxRepository(db);
    const auditRepo = new DrizzleAuditLogRepository(db);
    const audit = new AuditLogService({ repo: auditRepo });
    const id = await outboxRepo.enqueue({
      aggregateType: 'contract_request',
      aggregateId: AGG_ID,
      eventType: 'approved',
      payload: { step: 1 },
    });
    const svc = new OutboxService({ repo: outboxRepo, handler: auditLogOutboxHandler(audit) });
    const res = await svc.dispatch();
    expect(res.dispatched).toBeGreaterThanOrEqual(1);
    // событие записано в audit_log как outbox.approved
    const rows = await db.execute(
      sql`select count(*)::int as c from audit_log where event_type = 'outbox.approved'`,
    );
    expect(Number((rows as unknown as Array<{ c: number }>)[0]!.c)).toBeGreaterThanOrEqual(1);
    // outbox-строка помечена обработанной
    expect((await outboxRepo.listUnprocessed(1000)).some((r) => r.id === id)).toBe(false);
  });

  it('audit_log: запись попадает в месячную партицию (partition routing)', async () => {
    const auditRepo = new DrizzleAuditLogRepository(db);
    await auditRepo.append({
      eventType: 'login_success',
      actorUserId: null,
      actorEmailHmac: 'hmac-xyz',
      payload: { ip: '10.0.0.9' },
    });
    const pname = partitionName(monthStartUtc(new Date()));
    // Запрос напрямую к партиции текущего месяца — строка там.
    const rows = await db.execute(
      sql.raw(`select count(*)::int as c from public.${pname} where event_type = 'login_success'`),
    );
    expect(Number((rows as unknown as Array<{ c: number }>)[0]!.c)).toBeGreaterThanOrEqual(1);
  });

  it('jobs_log: record done/dead, countDeadSince, deleteByRetention', async () => {
    const repo = new DrizzleJobsLogRepository(db);
    await repo.record({
      queueName: 'ocr-processing',
      jobId: 'j1',
      type: 'ocr',
      status: 'done',
      attempts: 1,
    });
    await repo.record({
      queueName: 'ocr-processing',
      jobId: 'j2',
      type: 'ocr',
      status: 'dead',
      attempts: 3,
      lastError: 'boom',
    });
    expect(
      await repo.countDeadSince(new Date(Date.now() - 3_600_000).toISOString()),
    ).toBeGreaterThanOrEqual(1);
    // retention: ничего не удаляем «в будущем» (cutoff в прошлом), но вызов корректен
    const deleted = await repo.deleteByRetention(
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
      new Date(Date.now() - 90 * 86_400_000).toISOString(),
    );
    expect(deleted).toBe(0);
  });
});
