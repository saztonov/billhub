/**
 * Drizzle-only интеграционные тесты серверной авторизации операций доработки/повторной отправки
 * (Часть 3: закрытие подтверждённых пробелов).
 *   #1 send-to-revision — только согласующий текущего этапа (userMayActOnStage);
 *   #2 complete-revision — только владелец-контрагент своей заявки либо admin;
 *   #3 resubmit — владелец/admin + только из статусов rejected/withdrawn;
 *   #5 reject заявки «на доработке» — блок 409 (симметрично approve);
 *   #6 create-decision — тот же этапный гейт (закрытие legacy-обхода).
 *
 * Запуск: `RUN_INTEGRATION=1 npm test` или CI. Без Docker — пропускается.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema/index.js';
import {
  statuses,
  users,
  counterparties,
  constructionSites,
  paymentRequestFieldOptions,
  paymentRequests,
  approvalDecisions,
  rpStageAssignees,
} from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleApprovalRepository } from './approval.drizzle.js';
import { DrizzlePaymentRequestRepository } from './payment-request.drizzle.js';
import { ForbiddenError, ConflictError } from '../types.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

const ID = {
  cp: '11111111-1111-1111-1111-111111111111',
  cp2: '11111111-1111-1111-1111-1111111111bb',
  site: '22222222-2222-2222-2222-222222222222',
  siteRp: '22222222-2222-2222-2222-2222222222aa',
  ship: '33333333-3333-3333-3333-333333333333',
  omtsUser: '44444444-0000-0000-0000-000000000001',
  shtabUser: '44444444-0000-0000-0000-000000000002',
  rpUser: '44444444-0000-0000-0000-000000000003',
  admin: '44444444-0000-0000-0000-000000000004',
  creator: '44444444-0000-0000-0000-000000000005',
  cpUser: '44444444-0000-0000-0000-000000000006',
  cpUser2: '44444444-0000-0000-0000-000000000007',
  stShtab: '66666666-0000-0000-0000-000000000001',
  stOmts: '66666666-0000-0000-0000-000000000002',
  stRp: '66666666-0000-0000-0000-000000000003',
  stApproved: '66666666-0000-0000-0000-000000000004',
  stRevision: '66666666-0000-0000-0000-000000000005',
  stRejected: '66666666-0000-0000-0000-000000000006',
  stWithdrawn: '66666666-0000-0000-0000-000000000007',
  pr: '77777777-7777-7777-7777-777777777777',
  pr2: '77777777-7777-7777-7777-7777777777bb',
  d2: '88888888-0000-0000-0000-000000000002',
};

const FU = {
  deliveryDays: 7,
  deliveryDaysType: 'working',
  shippingConditionId: ID.ship,
  invoiceAmount: 100,
};

describe.skipIf(!RUN)('Серверная авторизация доработки/resubmit — Drizzle', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let repo!: DrizzleApprovalRepository;
  let prRepo!: DrizzlePaymentRequestRepository;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
    repo = new DrizzleApprovalRepository(db);
    prRepo = new DrizzlePaymentRequestRepository(db);
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE payment_requests, approval_decisions, payment_request_logs, statuses,
      users, counterparties, construction_sites, payment_request_field_options, suppliers,
      rp_stage_assignees, notifications
      RESTART IDENTITY CASCADE`;
    await db.insert(statuses).values(
      [
        { id: ID.stShtab, code: 'approv_shtab', name: 'Штаб' },
        { id: ID.stOmts, code: 'approv_omts', name: 'ОМТС' },
        { id: ID.stRp, code: 'approv_rp', name: 'На согласовании РП' },
        { id: ID.stApproved, code: 'approved', name: 'Согласована' },
        { id: ID.stRevision, code: 'revision', name: 'Доработка' },
        { id: ID.stRejected, code: 'rejected', name: 'Отклонена' },
        { id: ID.stWithdrawn, code: 'withdrawn', name: 'Отозвана' },
      ].map((s) => ({ ...s, entityType: 'payment_request' })),
    );
    await db.insert(counterparties).values([
      { id: ID.cp, name: 'CP', inn: '7710140679' },
      { id: ID.cp2, name: 'CP2', inn: '7702070139' },
    ]);
    await db.insert(constructionSites).values([
      { id: ID.site, name: 'Site' },
      { id: ID.siteRp, name: 'SiteRP' },
    ]);
    await db
      .insert(paymentRequestFieldOptions)
      .values({ id: ID.ship, fieldCode: 'shipping', value: 'Самовывоз' });
    await db.insert(users).values([
      { id: ID.omtsUser, email: 'omts@x', fullName: 'Omts', role: 'user', departmentId: 'omts' },
      { id: ID.shtabUser, email: 'sh@x', fullName: 'Shtab', role: 'user', departmentId: 'shtab' },
      { id: ID.rpUser, email: 'rp@x', fullName: 'RpAssignee', role: 'user', departmentId: 'shtab' },
      { id: ID.admin, email: 'a@x', fullName: 'Admin', role: 'admin' },
      { id: ID.creator, email: 'c@x', fullName: 'Creator', role: 'user' },
      { id: ID.cpUser, email: 'cpu@x', fullName: 'CpUser', role: 'counterparty_user' },
      { id: ID.cpUser2, email: 'cpu2@x', fullName: 'CpUser2', role: 'counterparty_user' },
    ]);
    await db.insert(rpStageAssignees).values({ constructionSiteId: ID.siteRp, userId: ID.rpUser });
  });

  async function seedPr(opts: {
    id?: string;
    counterpartyId?: string;
    siteId?: string;
    currentStage: number | null;
    statusId: string;
    previousStatusId?: string | null;
  }) {
    await db.insert(paymentRequests).values({
      id: opts.id ?? ID.pr,
      requestNumber: '0001',
      counterpartyId: opts.counterpartyId ?? ID.cp,
      statusId: opts.statusId,
      deliveryDays: 5,
      shippingConditionId: ID.ship,
      createdBy: ID.creator,
      siteId: opts.siteId ?? ID.siteRp,
      currentStage: opts.currentStage,
      previousStatusId: opts.previousStatusId ?? null,
      requestType: 'contractor',
      stageHistory: [],
      invoiceAmountHistory: [],
    });
  }

  async function readPr(id = ID.pr) {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id));
    return pr!;
  }

  async function seedOmtsPending(prId = ID.pr) {
    await db.insert(approvalDecisions).values({
      id: ID.d2,
      paymentRequestId: prId,
      stageOrder: 2,
      departmentId: 'omts',
      status: 'pending',
      isOmtsRp: false,
    });
  }

  /* ---------------- #1 send-to-revision — этапный гейт ---------------- */
  it('#1 send-to-revision: ОМТС на этапе 2 — ок; Штаб (чужой этап) — 403; admin — ок', async () => {
    await seedPr({ id: ID.pr, currentStage: 2, statusId: ID.stOmts });
    await seedPr({ id: ID.pr2, currentStage: 2, statusId: ID.stOmts });

    const forbidden = await repo.sendToRevision(ID.pr, ID.shtabUser, 'x', {
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(forbidden).toMatchObject({ ok: false, status: 403 });
    expect((await readPr(ID.pr)).statusId).toBe(ID.stOmts); // мутации не было

    const ok = await repo.sendToRevision(ID.pr, ID.omtsUser, 'дешевле', {
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(ok).toEqual({ ok: true });
    expect((await readPr(ID.pr)).statusId).toBe(ID.stRevision);

    const okAdmin = await repo.sendToRevision(ID.pr2, ID.admin, 'x', {
      userDepartment: null,
      isAdmin: true,
    });
    expect(okAdmin).toEqual({ ok: true });
  });

  /* ---------------- #2 complete-revision — гейт владельца ---------------- */
  it('#2 complete-revision: владелец-контрагент — ок; чужой контрагент — 403', async () => {
    await seedPr({ id: ID.pr, currentStage: 3, statusId: ID.stRp });
    await db.insert(approvalDecisions).values({
      paymentRequestId: ID.pr,
      stageOrder: 3,
      departmentId: 'rp',
      status: 'pending',
      isOmtsRp: false,
    });
    // Переводим в доработку (без actor — как раньше), затем проверяем гейт владельца.
    await repo.sendToRevision(ID.pr, ID.rpUser, 'доработать');

    const forbidden = await repo.completeRevision(ID.pr, ID.cpUser2, FU, {
      counterpartyId: ID.cp2,
      isAdmin: false,
    });
    expect(forbidden).toMatchObject({ ok: false, status: 403 });
    expect((await readPr(ID.pr)).statusId).toBe(ID.stRevision); // мутации не было

    const owned = await repo.completeRevision(ID.pr, ID.cpUser, FU, {
      counterpartyId: ID.cp,
      isAdmin: false,
    });
    expect(owned).toEqual({ ok: true });
  });

  it('#2 complete-revision: admin — ок для любой заявки', async () => {
    await seedPr({ id: ID.pr, currentStage: 3, statusId: ID.stRp, counterpartyId: ID.cp });
    await db.insert(approvalDecisions).values({
      paymentRequestId: ID.pr,
      stageOrder: 3,
      departmentId: 'rp',
      status: 'pending',
      isOmtsRp: false,
    });
    await repo.sendToRevision(ID.pr, ID.rpUser, 'доработать');

    const okAdmin = await repo.completeRevision(ID.pr, ID.admin, FU, {
      counterpartyId: null,
      isAdmin: true,
    });
    expect(okAdmin).toEqual({ ok: true });
  });

  /* ---------------- #3 resubmit — владелец/admin + статус ---------------- */
  it('#3 resubmit: чужой контрагент — 403; согласованную — 409; владелец отклонённую — ок', async () => {
    await seedPr({ id: ID.pr, currentStage: null, statusId: ID.stRejected, counterpartyId: ID.cp });
    await seedPr({
      id: ID.pr2,
      currentStage: null,
      statusId: ID.stApproved,
      counterpartyId: ID.cp,
    });

    await expect(
      prRepo.resubmit(ID.pr, { comment: 'x' }, ID.cpUser2, {
        counterpartyId: ID.cp2,
        isAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      prRepo.resubmit(ID.pr2, { comment: 'x' }, ID.cpUser, {
        counterpartyId: ID.cp,
        isAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await prRepo.resubmit(ID.pr, { comment: 'x' }, ID.cpUser, {
      counterpartyId: ID.cp,
      isAdmin: false,
    });
    expect((await readPr(ID.pr)).currentStage).toBe(1);
  });

  /* ---------------- #5 reject заявки «на доработке» ---------------- */
  it('#5 reject: заявку на доработке отклонить нельзя (409, симметрично approve)', async () => {
    await seedPr({
      id: ID.pr,
      currentStage: 2,
      statusId: ID.stRevision,
      previousStatusId: ID.stOmts,
    });
    await seedOmtsPending();

    const res = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'reject',
      comment: 'нет',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  /* ---------------- #6 create-decision — этапный гейт ---------------- */
  it('#6 create-decision: Штаб на этапе 2 — 403; ОМТС — ок', async () => {
    await seedPr({ id: ID.pr, currentStage: 2, statusId: ID.stOmts });
    await seedOmtsPending();

    const forbidden = await repo.createDecisionOnly({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.shtabUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(forbidden).toMatchObject({ ok: false, status: 403 });

    const ok = await repo.createDecisionOnly({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(ok.ok).toBe(true);
  });
});
