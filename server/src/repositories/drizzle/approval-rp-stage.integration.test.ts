/**
 * Drizzle-only интеграционные тесты этапа «РП» (stage 3, миграции 0015/0016):
 * переход ОМТС → РП по назначению rp_stage_assignees, финализация, авторизация по этапам,
 * доработка/возврат, reopen согласованной заявки, гейтинг очереди и счётчика.
 * Supabase-путь этап РП не поддерживает (legacy) — эквивалентность не сравнивается.
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
} from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleApprovalRepository } from './approval.drizzle.js';
import { DrizzleRpStageRepository } from './rp-stage.drizzle.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

const ID = {
  cp: '11111111-1111-1111-1111-111111111111',
  site: '22222222-2222-2222-2222-222222222222',
  siteRp: '22222222-2222-2222-2222-2222222222aa',
  ship: '33333333-3333-3333-3333-333333333333',
  omtsUser: '44444444-0000-0000-0000-000000000001',
  shtabUser: '44444444-0000-0000-0000-000000000002',
  rpUser: '44444444-0000-0000-0000-000000000003', // назначенец РП из Штаба
  admin: '44444444-0000-0000-0000-000000000004',
  creator: '44444444-0000-0000-0000-000000000005',
  stShtab: '66666666-0000-0000-0000-000000000001',
  stOmts: '66666666-0000-0000-0000-000000000002',
  stRp: '66666666-0000-0000-0000-000000000003',
  stApproved: '66666666-0000-0000-0000-000000000004',
  stRevision: '66666666-0000-0000-0000-000000000005',
  stRejected: '66666666-0000-0000-0000-000000000006',
  pr: '77777777-7777-7777-7777-777777777777',
  pr2: '77777777-7777-7777-7777-7777777777bb',
  d1: '88888888-0000-0000-0000-000000000001',
  d2: '88888888-0000-0000-0000-000000000002',
  d3: '88888888-0000-0000-0000-000000000003',
};

const FU = {
  deliveryDays: 7,
  deliveryDaysType: 'working',
  shippingConditionId: ID.ship,
  invoiceAmount: 100,
};

describe.skipIf(!RUN)('Этап «РП» (stage 3) — Drizzle-only', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let repo!: DrizzleApprovalRepository;
  let rpRepo!: DrizzleRpStageRepository;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
    repo = new DrizzleApprovalRepository(db);
    rpRepo = new DrizzleRpStageRepository(db);
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
      { id: ID.shtabUser, email: 'sh@x', fullName: 'Shtab', role: 'user', departmentId: 'shtab' },
      { id: ID.rpUser, email: 'rp@x', fullName: 'RpAssignee', role: 'user', departmentId: 'shtab' },
      { id: ID.admin, email: 'a@x', fullName: 'Admin', role: 'admin' },
      { id: ID.creator, email: 'c@x', fullName: 'Creator', role: 'user' },
    ]);
    // Назначенец РП по объекту siteRp; site — без назначенца.
    await db.insert(rpStageAssignees).values({ constructionSiteId: ID.siteRp, userId: ID.rpUser });
  });

  async function seedPr(opts: {
    id?: string;
    siteId?: string;
    currentStage: number | null;
    statusId: string;
    previousStatusId?: string | null;
    approvedAt?: string | null;
    omtsApprovedAt?: string | null;
    requestType?: string;
  }) {
    await db.insert(paymentRequests).values({
      id: opts.id ?? ID.pr,
      requestNumber: '0001',
      counterpartyId: ID.cp,
      statusId: opts.statusId,
      deliveryDays: 5,
      shippingConditionId: ID.ship,
      createdBy: ID.creator,
      siteId: opts.siteId ?? ID.siteRp,
      currentStage: opts.currentStage,
      previousStatusId: opts.previousStatusId ?? null,
      approvedAt: opts.approvedAt ?? null,
      omtsApprovedAt: opts.omtsApprovedAt ?? null,
      requestType: opts.requestType ?? 'contractor',
      stageHistory: [],
      invoiceAmountHistory: [],
    });
  }

  async function readPr(id = ID.pr) {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id));
    return pr!;
  }

  async function readDecisions(id = ID.pr) {
    return db.select().from(approvalDecisions).where(eq(approvalDecisions.paymentRequestId, id));
  }

  /** pending stage-2 ОМТС для заявки. */
  async function seedOmtsPending(prId = ID.pr, decId = ID.d2) {
    await db.insert(approvalDecisions).values({
      id: decId,
      paymentRequestId: prId,
      stageOrder: 2,
      departmentId: 'omts',
      status: 'pending',
      isOmtsRp: false,
    });
  }

  /** pending stage-3 РП для заявки. */
  async function seedRpPending(prId = ID.pr, decId = ID.d3) {
    await db.insert(approvalDecisions).values({
      id: decId,
      paymentRequestId: prId,
      stageOrder: 3,
      departmentId: 'rp',
      status: 'pending',
      isOmtsRp: false,
    });
  }

  it('approve ОМТС по объекту с назначенцем → этап 3 «РП», статус approv_rp, current_stage=3, уведомление назначенцу', async () => {
    await seedPr({ currentStage: 2, statusId: ID.stOmts });
    await seedOmtsPending();

    const res = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stRp);
    expect(pr.currentStage).toBe(3);
    expect(pr.omtsApprovedAt).toBeTruthy();
    expect(pr.approvedAt).toBeNull();

    const decs = await readDecisions();
    const rpDec = decs.find((d) => d.departmentId === 'rp');
    expect(rpDec).toBeTruthy();
    expect(rpDec!.stageOrder).toBe(3);
    expect(rpDec!.status).toBe('pending');

    const hist = pr.stageHistory as { event: string; stage: number; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'received', stage: 3, department: 'rp' });

    // Уведомление назначенцу — post-commit best-effort: даём микрозадержку.
    let notifs: { userId: string; type: string }[] = [];
    for (let i = 0; i < 20 && notifs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      notifs = await db
        .select({ userId: notifications.userId, type: notifications.type })
        .from(notifications);
    }
    expect(notifs).toEqual([{ userId: ID.rpUser, type: 'rp_pending' }]);
  });

  it('approve ОМТС по объекту без назначенца → сразу approved', async () => {
    await seedPr({ currentStage: 2, statusId: ID.stOmts, siteId: ID.site });
    await seedOmtsPending();

    const res = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stApproved);
    expect(pr.currentStage).toBeNull();
    expect(pr.approvedAt).toBeTruthy();
    expect((await readDecisions()).length).toBe(1);
  });

  it('этап 3: согласовать может назначенец (в т.ч. из Штаба) и админ; ОМТС/чужой Штаб → 403', async () => {
    await seedPr({ currentStage: 3, statusId: ID.stRp, omtsApprovedAt: '2026-01-01T00:00:00Z' });
    await seedRpPending();
    const omtsApprovedBefore = (await readPr()).omtsApprovedAt;

    const forbidOmts = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(forbidOmts).toMatchObject({ ok: false, status: 403 });

    const forbidShtab = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.shtabUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(forbidShtab).toMatchObject({ ok: false, status: 403 });

    const okAssignee = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: 'ок',
      userId: ID.rpUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(okAssignee.ok).toBe(true);

    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stApproved);
    expect(pr.currentStage).toBeNull();
    expect(pr.approvedAt).toBeTruthy();
    // omts_approved_at зафиксирован переходом 2→3 и финализацией этапа 3 не перезаписывается.
    expect(pr.omtsApprovedAt).toBe(omtsApprovedBefore);
  });

  it('этап 3: reject назначенцем → rejected_stage=3, департамент истории rp', async () => {
    await seedPr({ currentStage: 3, statusId: ID.stRp });
    await seedRpPending();

    const res = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'reject',
      comment: 'нет',
      userId: ID.rpUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);

    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stRejected);
    expect(pr.rejectedStage).toBe(3);
    expect(pr.currentStage).toBeNull();
    const hist = pr.stageHistory as { event: string; stage: number; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'rejected', stage: 3, department: 'rp' });
  });

  it('этап 3: доработка → блок согласования → «Доработано» возвращает на РП (pending сохраняется)', async () => {
    await seedPr({ currentStage: 3, statusId: ID.stRp });
    await seedRpPending();

    expect(await repo.sendToRevision(ID.pr, ID.rpUser, 'дешевле')).toEqual({ ok: true });
    let pr = await readPr();
    expect(pr.statusId).toBe(ID.stRevision);
    expect(pr.previousStatusId).toBe(ID.stRp);
    let hist = pr.stageHistory as { event: string; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'revision', department: 'rp' });

    const blocked = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.rpUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(blocked).toMatchObject({ ok: false, status: 409 });

    expect(await repo.completeRevision(ID.pr, ID.rpUser, FU)).toEqual({ ok: true });
    pr = await readPr();
    expect(pr.statusId).toBe(ID.stRp);
    expect(pr.previousStatusId).toBeNull();
    expect(pr.currentStage).toBe(3);
    hist = pr.stageHistory as { event: string; department: string }[];
    expect(hist.at(-1)).toMatchObject({ event: 'revision_complete', department: 'rp' });
    // Pending stage-3 «разморожен», новых решений не создано.
    const pending = (await readDecisions()).filter((d) => d.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.departmentId).toBe('rp');

    const ok = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.rpUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });
    expect(ok.ok).toBe(true);
    expect((await readPr()).statusId).toBe(ID.stApproved);
  });

  it('reopen согласованной заявки, проходившей РП: с назначенцем → этап 3; без назначенца → этап 2', async () => {
    // Кейc 1: назначенец есть → возврат на РП.
    await seedPr({
      currentStage: null,
      statusId: ID.stRevision,
      previousStatusId: ID.stApproved,
      omtsApprovedAt: '2026-02-01T00:00:00Z',
    });
    await db.insert(approvalDecisions).values([
      {
        id: ID.d2,
        paymentRequestId: ID.pr,
        stageOrder: 2,
        departmentId: 'omts',
        status: 'approved',
        isOmtsRp: false,
      },
      {
        id: ID.d3,
        paymentRequestId: ID.pr,
        stageOrder: 3,
        departmentId: 'rp',
        status: 'approved',
        isOmtsRp: false,
      },
    ]);
    const omtsApprovedBefore = (await readPr()).omtsApprovedAt;
    expect(await repo.completeRevision(ID.pr, ID.rpUser, FU)).toEqual({ ok: true });
    const pr = await readPr();
    expect(pr.statusId).toBe(ID.stRp);
    expect(pr.currentStage).toBe(3);
    expect(pr.approvedAt).toBeNull();
    // ОМТС уже согласовано — метрика не сброшена.
    expect(pr.omtsApprovedAt).toBe(omtsApprovedBefore);
    const pending = (await readDecisions()).filter((d) => d.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.departmentId).toBe('rp');
    expect(pending[0]!.stageOrder).toBe(3);

    // Кейс 2: назначенца больше нет → возврат на обычное ОМТС.
    await db.delete(rpStageAssignees).where(eq(rpStageAssignees.constructionSiteId, ID.siteRp));
    await seedPr({
      id: ID.pr2,
      currentStage: null,
      statusId: ID.stRevision,
      previousStatusId: ID.stApproved,
      omtsApprovedAt: '2026-02-01T00:00:00Z',
    });
    await db.insert(approvalDecisions).values({
      paymentRequestId: ID.pr2,
      stageOrder: 3,
      departmentId: 'rp',
      status: 'approved',
      isOmtsRp: false,
    });
    expect(await repo.completeRevision(ID.pr2, ID.omtsUser, FU)).toEqual({ ok: true });
    const pr2 = await readPr(ID.pr2);
    expect(pr2.statusId).toBe(ID.stOmts);
    expect(pr2.currentStage).toBe(2);
    // Возврат в обычное ОМТС перезапускает «Срок ОМТС».
    expect(pr2.omtsApprovedAt).toBeNull();
    expect(pr2.omtsEnteredAt).toBeTruthy();
  });

  it('очередь и счётчик РП: назначенец видит только свои объекты, админ — всё, доработка исключается', async () => {
    // pr — по siteRp (назначенец rpUser), pr2 — по site (назначенца нет, pending создан админом гипотетически).
    await seedPr({ currentStage: 3, statusId: ID.stRp });
    await seedRpPending(ID.pr, ID.d3);
    await seedPr({ id: ID.pr2, siteId: ID.site, currentStage: 3, statusId: ID.stRp });
    await seedRpPending(ID.pr2, ID.d2);

    const assigneeList = await repo.listRpPending({ userId: ID.rpUser, isAdmin: false });
    expect(assigneeList.map((r) => r.id)).toEqual([ID.pr]);

    const adminList = await repo.listRpPending({ userId: ID.admin, isAdmin: true });
    expect(adminList.map((r) => r.id).sort()).toEqual([ID.pr, ID.pr2].sort());

    const otherList = await repo.listRpPending({ userId: ID.shtabUser, isAdmin: false });
    expect(otherList).toEqual([]);

    expect(await repo.countRpPending({ userId: ID.rpUser, isAdmin: false })).toBe(1);
    expect(await repo.countRpPending({ userId: ID.admin, isAdmin: true })).toBe(2);

    // Заявка на доработке исключается из очереди и счётчика.
    await repo.sendToRevision(ID.pr, ID.rpUser, 'доработать');
    expect((await repo.listRpPending({ userId: ID.rpUser, isAdmin: false })).length).toBe(0);
    expect(await repo.countRpPending({ userId: ID.rpUser, isAdmin: false })).toBe(0);
  });

  it('rp-stage репозиторий: один сотрудник на объект (конфликт), кандидаты только Штаб/ОМТС', async () => {
    // siteRp уже занят (rpUser из beforeEach) → конфликт.
    await expect(rpRepo.addAssignee(ID.siteRp, ID.shtabUser)).rejects.toThrow(
      'На объект уже назначен сотрудник РП',
    );

    // Пользователь без отдела (creator) — не кандидат.
    await expect(rpRepo.addAssignee(ID.site, ID.creator)).rejects.toThrow();

    await rpRepo.addAssignee(ID.site, ID.omtsUser);
    expect((await rpRepo.getAssigneeSiteIds(ID.omtsUser)).sort()).toEqual([ID.site]);

    const candidates = await rpRepo.listCandidates();
    expect(candidates.map((c) => c.id).sort()).toEqual(
      [ID.omtsUser, ID.shtabUser, ID.rpUser].sort(),
    );

    const list = await rpRepo.listAssignees();
    expect(list).toHaveLength(2);
    const bySite = new Map(list.map((a) => [a.siteId, a.userId]));
    expect(bySite.get(ID.site)).toBe(ID.omtsUser);
    expect(bySite.get(ID.siteRp)).toBe(ID.rpUser);
  });
});
