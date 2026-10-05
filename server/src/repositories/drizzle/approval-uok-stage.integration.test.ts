/**
 * Drizzle-only интеграционные тесты этапа «УОК» (stage 3, миграции 0021/0022):
 * ОМТС → УОК только при сумме счёта строго свыше порога (settings.uok_amount_threshold),
 * УОК → РП (stage 4) / финализация, авторизация этапа (подразделение 'uok'), отклонение,
 * доработка, рубеж повторного согласования после «Доработано», очередь и счётчик,
 * уведомления повторной отправки. Supabase-путь этап УОК не поддерживает (legacy).
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
  notifications,
  userConstructionSitesMapping,
} from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleApprovalRepository } from './approval.drizzle.js';
import { DrizzleNotificationActionRepository } from './notification-action.drizzle.js';
import { getUokThreshold, setUokThreshold } from '../../services/uok/uok-threshold-setting.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

type Dept = 'omts' | 'shtab' | 'uok' | 'rp';

const ID = {
  cp: '11111111-1111-1111-1111-111111111111',
  site: '22222222-2222-2222-2222-222222222222',
  siteRp: '22222222-2222-2222-2222-2222222222aa',
  ship: '33333333-3333-3333-3333-333333333333',
  omtsUser: '44444444-0000-0000-0000-000000000001',
  shtabUser: '44444444-0000-0000-0000-000000000002',
  rpUser: '44444444-0000-0000-0000-000000000003',
  admin: '44444444-0000-0000-0000-000000000004',
  creator: '44444444-0000-0000-0000-000000000005',
  uokUser: '44444444-0000-0000-0000-000000000006', // УОК-офис, все объекты
  uokSiteUser: '44444444-0000-0000-0000-000000000007', // УОК-офис, только siteRp
  stShtab: '66666666-0000-0000-0000-000000000001',
  stOmts: '66666666-0000-0000-0000-000000000002',
  stRp: '66666666-0000-0000-0000-000000000003',
  stApproved: '66666666-0000-0000-0000-000000000004',
  stRevision: '66666666-0000-0000-0000-000000000005',
  stRejected: '66666666-0000-0000-0000-000000000006',
  stUok: '66666666-0000-0000-0000-000000000007',
  pr: '77777777-7777-7777-7777-777777777777',
  pr2: '77777777-7777-7777-7777-7777777777bb',
};

const fu = (invoiceAmount: number) => ({
  deliveryDays: 7,
  deliveryDaysType: 'working',
  shippingConditionId: ID.ship,
  invoiceAmount,
});

describe.skipIf(!RUN)('Этап «УОК» (stage 3) — Drizzle-only', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let repo!: DrizzleApprovalRepository;
  let notifRepo!: DrizzleNotificationActionRepository;
  let migratedThreshold = 0;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
    repo = new DrizzleApprovalRepository(db);
    notifRepo = new DrizzleNotificationActionRepository(db);
    // Порог, засеянный миграцией 0022 (до TRUNCATE в beforeEach).
    migratedThreshold = await getUokThreshold(db);
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE payment_requests, approval_decisions, payment_request_logs, statuses,
      users, counterparties, construction_sites, payment_request_field_options, suppliers,
      rp_stage_assignees, notifications, user_construction_sites_mapping, settings
      RESTART IDENTITY CASCADE`;
    await db.insert(statuses).values(
      [
        { id: ID.stShtab, code: 'approv_shtab', name: 'Штаб' },
        { id: ID.stOmts, code: 'approv_omts', name: 'ОМТС' },
        { id: ID.stUok, code: 'approv_uok', name: 'Согласование УОК' },
        { id: ID.stRp, code: 'approv_rp', name: 'На согласовании РП' },
        { id: ID.stApproved, code: 'approved', name: 'Согласована' },
        { id: ID.stRevision, code: 'revision', name: 'Доработка' },
        { id: ID.stRejected, code: 'rejected', name: 'Отклонена' },
      ].map((s) => ({ ...s, entityType: 'payment_request' })),
    );
    await db.insert(counterparties).values({ id: ID.cp, name: 'CP', inn: '7710140679' });
    await db.insert(constructionSites).values([
      { id: ID.site, name: 'Site' },
      { id: ID.siteRp, name: 'SiteRP' },
    ]);
    await db
      .insert(paymentRequestFieldOptions)
      .values({ id: ID.ship, fieldCode: 'shipping', value: 'Самовывоз' });
    await db.insert(users).values([
      { id: ID.omtsUser, email: 'omts@x', fullName: 'Omts', role: 'user', departmentId: 'omts' },
      {
        id: ID.shtabUser,
        email: 'sh@x',
        fullName: 'Shtab',
        role: 'user',
        departmentId: 'shtab',
        allSites: true,
      },
      { id: ID.rpUser, email: 'rp@x', fullName: 'Rp', role: 'user', departmentId: 'shtab' },
      { id: ID.admin, email: 'a@x', fullName: 'Admin', role: 'admin', allSites: true },
      { id: ID.creator, email: 'c@x', fullName: 'Creator', role: 'user' },
      {
        id: ID.uokUser,
        email: 'uok@x',
        fullName: 'Uok',
        role: 'user',
        departmentId: 'uok',
        allSites: true,
      },
      { id: ID.uokSiteUser, email: 'uok2@x', fullName: 'Uok2', role: 'user', departmentId: 'uok' },
    ]);
    await db
      .insert(userConstructionSitesMapping)
      .values({ userId: ID.uokSiteUser, constructionSiteId: ID.siteRp });
    // Назначенец РП по объекту siteRp; site — без назначенца.
    await db.insert(rpStageAssignees).values({ constructionSiteId: ID.siteRp, userId: ID.rpUser });
  });

  async function seedPr(opts: {
    id?: string;
    siteId?: string;
    currentStage: number | null;
    statusId: string;
    invoiceAmount: number | null;
    previousStatusId?: string | null;
  }) {
    await db.insert(paymentRequests).values({
      id: opts.id ?? ID.pr,
      requestNumber: '0001',
      counterpartyId: ID.cp,
      statusId: opts.statusId,
      deliveryDays: 5,
      shippingConditionId: ID.ship,
      createdBy: ID.creator,
      siteId: opts.siteId ?? ID.site,
      currentStage: opts.currentStage,
      previousStatusId: opts.previousStatusId ?? null,
      requestType: 'contractor',
      invoiceAmount: opts.invoiceAmount,
      stageHistory: [],
      invoiceAmountHistory: [],
    });
  }

  async function seedDecision(
    stageOrder: number,
    departmentId: Dept,
    status: 'pending' | 'approved' = 'pending',
    prId = ID.pr,
  ) {
    await db
      .insert(approvalDecisions)
      .values({ paymentRequestId: prId, stageOrder, departmentId, status, isOmtsRp: false });
  }

  async function readPr(id = ID.pr) {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id));
    return pr!;
  }

  async function pendingOf(id = ID.pr) {
    const decs = await db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.paymentRequestId, id));
    return decs.filter((d) => d.status === 'pending').map((d) => [d.stageOrder, d.departmentId]);
  }

  function decide(userId: string, userDepartment: string | null, action: 'approve' | 'reject') {
    return repo.decide({
      paymentRequestId: ID.pr,
      action,
      comment: 'c',
      userId,
      userDepartment,
      isAdmin: false,
    });
  }

  it('миграция 0022 засевает порог 400 000', () => {
    expect(migratedThreshold).toBe(400_000);
  });

  it('ОМТС, сумма свыше порога → этап 3 «УОК»; права этапа; УОК → финал на объекте без РП', async () => {
    await seedPr({ currentStage: 2, statusId: ID.stOmts, invoiceAmount: 500_000 });
    await seedDecision(2, 'omts');

    expect((await decide(ID.omtsUser, 'omts', 'approve')).ok).toBe(true);
    let pr = await readPr();
    expect(pr.currentStage).toBe(3);
    expect(pr.statusId).toBe(ID.stUok);
    expect(pr.omtsApprovedAt).toBeTruthy();
    expect(await pendingOf()).toEqual([[3, 'uok']]);
    const hist = pr.stageHistory as { event: string; stage: number; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'received', stage: 3, department: 'uok' });
    const omtsApprovedAt = pr.omtsApprovedAt;

    expect(await decide(ID.omtsUser, 'omts', 'approve')).toMatchObject({ ok: false, status: 403 });
    expect(await decide(ID.shtabUser, 'shtab', 'approve')).toMatchObject({
      ok: false,
      status: 403,
    });

    expect((await decide(ID.uokUser, 'uok', 'approve')).ok).toBe(true);
    pr = await readPr();
    expect(pr.statusId).toBe(ID.stApproved);
    expect(pr.currentStage).toBeNull();
    expect(pr.omtsApprovedAt).toBe(omtsApprovedAt);
  });

  it('сумма ровно 400 000 → мимо УОК; порог из настройки меняет маршрут', async () => {
    await seedPr({ currentStage: 2, statusId: ID.stOmts, invoiceAmount: 400_000 });
    await seedDecision(2, 'omts');
    expect((await decide(ID.omtsUser, 'omts', 'approve')).ok).toBe(true);
    expect((await readPr()).statusId).toBe(ID.stApproved);

    await setUokThreshold(db, 1_000_000);
    await seedPr({ id: ID.pr2, currentStage: 2, statusId: ID.stOmts, invoiceAmount: 500_000 });
    await seedDecision(2, 'omts', 'pending', ID.pr2);
    const res = await repo.decide({
      paymentRequestId: ID.pr2,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);
    expect((await readPr(ID.pr2)).statusId).toBe(ID.stApproved);
  });

  it('УОК → этап 4 «РП» на объекте с назначенцем, уведомление назначенцу', async () => {
    await seedPr({
      siteId: ID.siteRp,
      currentStage: 3,
      statusId: ID.stUok,
      invoiceAmount: 900_000,
    });
    await seedDecision(3, 'uok');

    // Сотрудник УОК по объекту из личного списка.
    expect((await decide(ID.uokSiteUser, 'uok', 'approve')).ok).toBe(true);
    const pr = await readPr();
    expect(pr.currentStage).toBe(4);
    expect(pr.statusId).toBe(ID.stRp);
    expect(await pendingOf()).toEqual([[4, 'rp']]);

    let notifs: { userId: string; type: string }[] = [];
    for (let i = 0; i < 20 && notifs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      notifs = await db
        .select({ userId: notifications.userId, type: notifications.type })
        .from(notifications);
    }
    expect(notifs).toEqual([{ userId: ID.rpUser, type: 'rp_pending' }]);
    expect(await decide(ID.uokUser, 'uok', 'approve')).toMatchObject({ ok: false, status: 403 });
  });

  it('отклонение на УОК → rejected_stage=3; повторная отправка уведомляет Штаб и УОК объекта', async () => {
    await seedPr({
      siteId: ID.siteRp,
      currentStage: 3,
      statusId: ID.stUok,
      invoiceAmount: 600_000,
    });
    await seedDecision(3, 'uok');

    expect((await decide(ID.uokUser, 'uok', 'reject')).ok).toBe(true);
    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stRejected);
    expect(pr.rejectedStage).toBe(3);
    const hist = pr.stageHistory as { event: string; stage: number; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'rejected', stage: 3, department: 'uok' });

    await notifRepo.paymentResubmitted({
      paymentRequestId: ID.pr,
      actorUserId: ID.creator,
      rejectedStage: 3,
    });
    const rows = await db
      .select({ userId: notifications.userId, departmentId: notifications.departmentId })
      .from(notifications);
    expect(rows.map((r) => `${r.userId}:${r.departmentId}`).sort()).toEqual(
      [`${ID.shtabUser}:shtab`, `${ID.uokUser}:uok`, `${ID.uokSiteUser}:uok`].sort(),
    );
  });

  it('доработка на УОК: ОМТС → 403, УОК — ок; «Доработано» возвращает на УОК', async () => {
    await seedPr({ currentStage: 3, statusId: ID.stUok, invoiceAmount: 600_000 });
    await seedDecision(3, 'uok');

    const forbid = await repo.sendToRevision(ID.pr, ID.omtsUser, 'x', {
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(forbid).toMatchObject({ ok: false, status: 403 });
    expect(
      await repo.sendToRevision(ID.pr, ID.uokUser, 'дешевле', {
        userDepartment: 'uok',
        isAdmin: false,
      }),
    ).toEqual({ ok: true });
    expect((await readPr()).statusId).toBe(ID.stRevision);

    expect(await repo.completeRevision(ID.pr, ID.creator, fu(600_000))).toEqual({ ok: true });
    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stUok);
    expect(pr.currentStage).toBe(3);
    expect(await pendingOf()).toEqual([[3, 'uok']]);
  });

  it('«Доработано» по согласованной заявке: рубеж РП / УОК / ОМТС с учётом суммы', async () => {
    // approvedAmount — сумма, по которой заявка была согласована; amount — сумма после доработки.
    const reopen = async (
      siteId: string,
      passed: [number, Dept][],
      amount: number,
      approvedAmount = 100,
    ) => {
      await sql`DELETE FROM approval_decisions`;
      await sql`DELETE FROM payment_requests`;
      await seedPr({
        siteId,
        currentStage: null,
        statusId: ID.stRevision,
        previousStatusId: ID.stApproved,
        invoiceAmount: approvedAmount,
      });
      for (const [stage, dept] of passed) await seedDecision(stage, dept, 'approved');
      expect(await repo.completeRevision(ID.pr, ID.admin, fu(amount))).toEqual({ ok: true });
      return readPr();
    };

    // Проходила только ОМТС (до появления УОК), сумма свыше порога → УОК.
    let pr = await reopen(ID.site, [[2, 'omts']], 500_000);
    expect([pr.currentStage, pr.statusId]).toEqual([3, ID.stUok]);
    expect(await pendingOf()).toEqual([[3, 'uok']]);

    // Проходила УОК и РП на 500 000, сумма не выросла, назначенец есть → РП.
    pr = await reopen(
      ID.siteRp,
      [
        [2, 'omts'],
        [3, 'uok'],
        [4, 'rp'],
      ],
      500_000,
      500_000,
    );
    expect(pr.currentStage).toBe(4);

    // Проходила УОК и РП на 500 000, сумму подняли → УОК пересматривает новую сумму.
    pr = await reopen(
      ID.siteRp,
      [
        [2, 'omts'],
        [3, 'uok'],
        [4, 'rp'],
      ],
      600_000,
      500_000,
    );
    expect(pr.currentStage).toBe(3);

    // Проходила РП без УОК, сумму подняли выше порога → УОК.
    pr = await reopen(
      ID.siteRp,
      [
        [2, 'omts'],
        [4, 'rp'],
      ],
      500_000,
    );
    expect(pr.currentStage).toBe(3);

    // Проходила РП без УОК, сумма не выше порога → РП (как раньше).
    pr = await reopen(
      ID.siteRp,
      [
        [2, 'omts'],
        [4, 'rp'],
      ],
      100,
    );
    expect(pr.currentStage).toBe(4);

    // Проходила УОК, сумму снизили, РП нет → ОМТС, «Срок ОМТС» перезапущен.
    pr = await reopen(
      ID.site,
      [
        [2, 'omts'],
        [3, 'uok'],
      ],
      100,
      500_000,
    );
    expect([pr.currentStage, pr.statusId]).toEqual([2, ID.stOmts]);
    expect(pr.omtsApprovedAt).toBeNull();
    expect(pr.omtsEnteredAt).toBeTruthy();
  });

  it('доработка на этапе РП: рост суммы выше порога → обратно на УОК, затем РП', async () => {
    // Заявка с суммой не выше порога прошла мимо УОК и стоит на РП.
    await seedPr({ siteId: ID.siteRp, currentStage: 4, statusId: ID.stRp, invoiceAmount: 100 });
    await seedDecision(2, 'omts', 'approved');
    await seedDecision(4, 'rp');
    const toRevision = () =>
      repo.sendToRevision(ID.pr, ID.rpUser, 'x', { userDepartment: 'shtab', isAdmin: false });

    expect(await toRevision()).toEqual({ ok: true });
    expect(await repo.completeRevision(ID.pr, ID.creator, fu(700_000))).toEqual({ ok: true });
    let pr = await readPr();
    expect([pr.currentStage, pr.statusId, pr.previousStatusId]).toEqual([3, ID.stUok, null]);
    expect(await pendingOf()).toEqual([[3, 'uok']]);
    expect(await decide(ID.rpUser, 'shtab', 'approve')).toMatchObject({ ok: false, status: 403 });

    expect((await decide(ID.uokSiteUser, 'uok', 'approve')).ok).toBe(true);
    expect((await readPr()).currentStage).toBe(4);
    expect(await pendingOf()).toEqual([[4, 'rp']]);

    // Без роста суммы (УОК уже согласовал 700 000) доработка на РП оставляет заявку на РП.
    expect(await toRevision()).toEqual({ ok: true });
    expect(await repo.completeRevision(ID.pr, ID.creator, fu(700_000))).toEqual({ ok: true });
    pr = await readPr();
    expect([pr.currentStage, pr.statusId]).toEqual([4, ID.stRp]);
  });

  it('УОК согласует только по своим объектам; на чужом объекте — 403', async () => {
    await seedPr({ siteId: ID.site, currentStage: 3, statusId: ID.stUok, invoiceAmount: 600_000 });
    await seedDecision(3, 'uok');
    expect(await decide(ID.uokSiteUser, 'uok', 'approve')).toMatchObject({
      ok: false,
      status: 403,
    });
    const revision = await repo.sendToRevision(ID.pr, ID.uokSiteUser, 'x', {
      userDepartment: 'uok',
      isAdmin: false,
    });
    expect(revision).toMatchObject({ ok: false, status: 403 });
    expect((await decide(ID.uokUser, 'uok', 'approve')).ok).toBe(true);
  });

  it('очередь и счётчик УОК: все объекты / свои объекты / админ; доработка исключается', async () => {
    await seedPr({ siteId: ID.site, currentStage: 3, statusId: ID.stUok, invoiceAmount: 700_000 });
    await seedDecision(3, 'uok');
    await seedPr({
      id: ID.pr2,
      siteId: ID.siteRp,
      currentStage: 3,
      statusId: ID.stUok,
      invoiceAmount: 700_000,
    });
    await seedDecision(3, 'uok', 'pending', ID.pr2);

    const all = await repo.listPendingByDepartment({
      userId: ID.uokUser,
      department: 'uok',
      isAdmin: false,
    });
    expect(all.map((r) => r.id).sort()).toEqual([ID.pr, ID.pr2].sort());
    const scoped = await repo.listPendingByDepartment({
      userId: ID.uokSiteUser,
      department: 'uok',
      isAdmin: false,
    });
    expect(scoped.map((r) => r.id)).toEqual([ID.pr2]);
    expect(
      await repo.countPendingByDepartment({ userId: ID.admin, department: 'uok', isAdmin: true }),
    ).toBe(2);

    await repo.sendToRevision(ID.pr, ID.uokUser, 'x', { userDepartment: 'uok', isAdmin: false });
    expect(
      await repo.countPendingByDepartment({
        userId: ID.uokUser,
        department: 'uok',
        isAdmin: false,
      }),
    ).toBe(1);
  });
});
