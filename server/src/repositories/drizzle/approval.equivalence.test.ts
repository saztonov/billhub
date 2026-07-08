/**
 * EQUIVALENCE-тесты согласований (Phase 7, КРИТИЧНЫЙ): один и тот же сценарий машины состояний
 * выполняется на SupabaseApprovalRepository (FakeSupabase) и DrizzleApprovalRepository
 * (testcontainers PostgreSQL, baseline + миграции 001-007). Сравнивается наблюдаемый конечный
 * стейт: поля payment_requests, множество approval_decisions, порядок payment_request_logs,
 * события stage_history (без волатильных id/времени).
 *
 * Запуск: `RUN_INTEGRATION=1 npm test` или CI. Без Docker — пропускается.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  suppliers,
  paymentRequests,
  approvalDecisions,
  paymentRequestLogs,
  settings,
} from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleApprovalRepository } from './approval.drizzle.js';
import { SupabaseApprovalRepository } from '../supabase/approval.supabase.js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import type { ApprovalRepository } from '../approval.repository.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

/* Фиксированные uuid — одинаковые в обоих хранилищах, чтобы status_id и пр. совпадали напрямую. */
const ID = {
  cp: '11111111-1111-1111-1111-111111111111',
  site: '22222222-2222-2222-2222-222222222222',
  siteRp: '22222222-2222-2222-2222-2222222222aa',
  ship: '33333333-3333-3333-3333-333333333333',
  u1: '44444444-4444-4444-4444-444444444444',
  creator: '44444444-4444-4444-4444-4444444444cc',
  sup1: '55555555-5555-5555-5555-555555555551',
  sup2: '55555555-5555-5555-5555-555555555552',
  stShtab: '66666666-0000-0000-0000-000000000001',
  stOmts: '66666666-0000-0000-0000-000000000002',
  stRp: '66666666-0000-0000-0000-000000000003',
  stApproved: '66666666-0000-0000-0000-000000000004',
  stRevision: '66666666-0000-0000-0000-000000000005',
  stRejected: '66666666-0000-0000-0000-000000000006',
  pr: '77777777-7777-7777-7777-777777777777',
  d1: '88888888-0000-0000-0000-000000000001',
  d2: '88888888-0000-0000-0000-000000000002',
};

const STATUS_SEED = [
  { id: ID.stShtab, code: 'approv_shtab', name: 'Штаб' },
  { id: ID.stOmts, code: 'approv_omts', name: 'ОМТС' },
  { id: ID.stRp, code: 'approv_omts_rp', name: 'ОМТС РП' },
  { id: ID.stApproved, code: 'approved', name: 'Согласована' },
  { id: ID.stRevision, code: 'revision', name: 'Доработка' },
  { id: ID.stRejected, code: 'rejected', name: 'Отклонена' },
];

interface PrSeed {
  current_stage: number | null;
  status_id: string;
  site_id?: string;
  supplier_id?: string | null;
  approved_at?: string | null;
  previous_status_id?: string | null;
  withdrawn_at?: string | null;
  withdrawal_comment?: string | null;
  invoice_amount?: number | null;
  request_type?: string;
  omts_approved_at?: string | null;
}
interface DecSeed {
  id: string;
  stage_order: number;
  department_id: string;
  status: string;
  is_omts_rp?: boolean;
}

/** Нормализация конечного стейта для побайтного сравнения двух реализаций. */
function normalize(
  pr: Record<string, unknown>,
  decs: Record<string, unknown>[],
  logs: Record<string, unknown>[],
) {
  const hist = (pr.stage_history as { event: string; stage?: number; department?: string }[]) ?? [];
  // invoice_amount_history: суммы приводим к числу (Fake хранит number, Drizzle — numeric-строку).
  // Сравнивается только сценарий С ИЗМЕНЕНИЕМ суммы — путь без изменения не эквивалентен через Fake
  // (Fake-Supabase хранит число и не воспроизводит string!==number асимметрию реального PostgREST).
  const amountHist = (pr.invoice_amount_history as { amount?: unknown }[]) ?? [];
  return {
    status_id: pr.status_id,
    current_stage: pr.current_stage,
    rejected_stage: pr.rejected_stage ?? null,
    previous_status_id: pr.previous_status_id ?? null,
    approved: pr.approved_at != null,
    rejected: pr.rejected_at != null,
    omtsEntered: pr.omts_entered_at != null,
    omtsApproved: pr.omts_approved_at != null,
    withdrawn: pr.withdrawn_at != null,
    invoice_amount: pr.invoice_amount != null ? Number(pr.invoice_amount) : null,
    invoiceHistoryAmounts: amountHist.map((h) => (h.amount != null ? Number(h.amount) : null)),
    decisions: decs
      .map((d) => ({
        stage_order: d.stage_order,
        department_id: d.department_id,
        status: d.status,
        is_omts_rp: d.is_omts_rp ?? false,
        hasUser: d.user_id != null,
      }))
      .sort((a, b) =>
        a.stage_order !== b.stage_order
          ? (a.stage_order as number) - (b.stage_order as number)
          : Number(a.is_omts_rp) - Number(b.is_omts_rp),
      ),
    logActions: logs.map((l) => l.action),
    historyEvents: hist.map((e) => ({ event: e.event, stage: e.stage, department: e.department })),
  };
}

describe.skipIf(!RUN)('Approvals equivalence (Supabase fake ↔ Drizzle testcontainers)', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE payment_requests, approval_decisions, payment_request_logs, statuses,
      users, counterparties, construction_sites, payment_request_field_options, suppliers, settings
      RESTART IDENTITY CASCADE`;
  });

  /** Засеять справочники в PG и Fake одинаково. */
  async function seedRefs(fake: FakeSupabase) {
    await db.insert(statuses).values(
      STATUS_SEED.map((s) => ({
        id: s.id,
        entityType: 'payment_request',
        code: s.code,
        name: s.name,
      })),
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
      { id: ID.u1, email: 'u1@x', fullName: 'User One', role: 'user' },
      { id: ID.creator, email: 'c@x', fullName: 'Creator', role: 'user' },
    ]);
    await db.insert(suppliers).values([
      { id: ID.sup1, name: 'Старый', inn: '111' },
      { id: ID.sup2, name: 'Новый', inn: '222' },
    ]);
    await db.insert(settings).values([
      { key: 'omts_rp_sites', value: { site_ids: [ID.siteRp] } },
      { key: 'omts_rp_config', value: { responsible_user_id: 'resp' } },
    ]);

    fake.seed(
      'statuses',
      STATUS_SEED.map((s) => ({
        id: s.id,
        entity_type: 'payment_request',
        code: s.code,
        name: s.name,
      })),
    );
    fake.seed('users', [
      { id: ID.u1, email: 'u1@x', full_name: 'User One' },
      { id: ID.creator, email: 'c@x', full_name: 'Creator' },
    ]);
    fake.seed('suppliers', [
      { id: ID.sup1, name: 'Старый', inn: '111', last_security_status: null },
      { id: ID.sup2, name: 'Новый', inn: '222', last_security_status: null },
    ]);
    fake.seed('settings', [
      { key: 'omts_rp_sites', value: { site_ids: [ID.siteRp] } },
      { key: 'omts_rp_config', value: { responsible_user_id: 'resp' } },
    ]);
  }

  async function seedScenario(fake: FakeSupabase, pr: PrSeed, decs: DecSeed[]) {
    const siteId = pr.site_id ?? ID.site;
    await db.insert(paymentRequests).values({
      id: ID.pr,
      requestNumber: '0001',
      counterpartyId: ID.cp,
      statusId: pr.status_id,
      deliveryDays: 5,
      shippingConditionId: ID.ship,
      createdBy: ID.creator,
      siteId,
      currentStage: pr.current_stage,
      supplierId: pr.supplier_id ?? null,
      approvedAt: pr.approved_at ?? null,
      previousStatusId: pr.previous_status_id ?? null,
      withdrawnAt: pr.withdrawn_at ?? null,
      withdrawalComment: pr.withdrawal_comment ?? null,
      invoiceAmount: pr.invoice_amount != null ? Number(pr.invoice_amount) : null,
      requestType: pr.request_type ?? 'contractor',
      omtsApprovedAt: pr.omts_approved_at ?? null,
      stageHistory: [],
      invoiceAmountHistory: [],
    });
    if (decs.length > 0) {
      await db.insert(approvalDecisions).values(
        decs.map((d) => ({
          id: d.id,
          paymentRequestId: ID.pr,
          stageOrder: d.stage_order,
          departmentId: d.department_id as 'omts' | 'shtab' | 'smetny',
          status: d.status,
          isOmtsRp: d.is_omts_rp ?? false,
        })),
      );
    }
    fake.seed('payment_requests', [
      {
        id: ID.pr,
        request_number: '0001',
        counterparty_id: ID.cp,
        status_id: pr.status_id,
        site_id: siteId,
        current_stage: pr.current_stage,
        supplier_id: pr.supplier_id ?? null,
        approved_at: pr.approved_at ?? null,
        previous_status_id: pr.previous_status_id ?? null,
        withdrawn_at: pr.withdrawn_at ?? null,
        withdrawal_comment: pr.withdrawal_comment ?? null,
        invoice_amount: pr.invoice_amount ?? null,
        request_type: pr.request_type ?? 'contractor',
        omts_approved_at: pr.omts_approved_at ?? null,
        created_by: ID.creator,
        stage_history: [],
        invoice_amount_history: [],
      },
    ]);
    fake.seed(
      'approval_decisions',
      decs.map((d) => ({
        id: d.id,
        payment_request_id: ID.pr,
        stage_order: d.stage_order,
        department_id: d.department_id,
        status: d.status,
        is_omts_rp: d.is_omts_rp ?? false,
        comment: '',
      })),
    );
  }

  async function readDrizzle() {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, ID.pr));
    const decs = await db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.paymentRequestId, ID.pr));
    const logs = await db
      .select()
      .from(paymentRequestLogs)
      .where(eq(paymentRequestLogs.paymentRequestId, ID.pr))
      .orderBy(paymentRequestLogs.createdAt);
    // snake-case проекция для общей нормализации
    return normalize(
      {
        status_id: pr!.statusId,
        current_stage: pr!.currentStage,
        rejected_stage: pr!.rejectedStage,
        previous_status_id: pr!.previousStatusId,
        approved_at: pr!.approvedAt,
        rejected_at: pr!.rejectedAt,
        omts_entered_at: pr!.omtsEnteredAt,
        omts_approved_at: pr!.omtsApprovedAt,
        withdrawn_at: pr!.withdrawnAt,
        invoice_amount: pr!.invoiceAmount,
        invoice_amount_history: pr!.invoiceAmountHistory,
        stage_history: pr!.stageHistory,
      },
      decs.map((d) => ({ ...d, department_id: d.departmentId })),
      logs as Record<string, unknown>[],
    );
  }

  function readFake(fake: FakeSupabase) {
    return normalize(
      fake.tableRows('payment_requests')[0]!,
      fake.tableRows('approval_decisions'),
      fake.tableRows('payment_request_logs'),
    );
  }

  function repos(fake: FakeSupabase): { d: ApprovalRepository; s: ApprovalRepository } {
    return {
      d: new DrizzleApprovalRepository(db),
      s: new SupabaseApprovalRepository(fake as unknown as SupabaseClient),
    };
  }

  it('S1: approve Штаб → ОМТС эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(fake, { current_stage: 1, status_id: ID.stShtab }, [
      { id: ID.d1, stage_order: 1, department_id: 'shtab', status: 'pending' },
    ]);
    const { d, s } = repos(fake);
    const input = {
      paymentRequestId: ID.pr,
      department: 'shtab',
      action: 'approve' as const,
      comment: 'ок',
      userId: ID.u1,
      isAdmin: false,
    };
    await d.decide(input);
    await s.decide(input);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S5: reject штатный на ОМТС эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(
      fake,
      { current_stage: 2, status_id: ID.stOmts, previous_status_id: ID.stOmts },
      [{ id: ID.d2, stage_order: 2, department_id: 'omts', status: 'pending' }],
    );
    const { d, s } = repos(fake);
    const input = {
      paymentRequestId: ID.pr,
      department: 'omts',
      action: 'reject' as const,
      comment: 'нет',
      userId: ID.u1,
      isAdmin: false,
    };
    await d.decide(input);
    await s.decide(input);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S11: send-to-revision из approved эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(
      fake,
      { current_stage: null, status_id: ID.stApproved, approved_at: '2026-01-01T00:00:00Z' },
      [],
    );
    const { d, s } = repos(fake);
    await d.sendToRevision(ID.pr, ID.u1, 'доработать');
    await s.sendToRevision(ID.pr, ID.u1, 'доработать');
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S12: complete-revision из approved (contractor) → повторное ОМТС эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(
      fake,
      {
        // Согласованная заявка после sendToRevision: current_stage = null.
        current_stage: null,
        status_id: ID.stRevision,
        previous_status_id: ID.stApproved,
        request_type: 'contractor',
        withdrawn_at: '2026-01-01T00:00:00Z',
        withdrawal_comment: 'был отзыв',
        invoice_amount: 100,
      },
      [{ id: ID.d2, stage_order: 2, department_id: 'omts', status: 'approved', is_omts_rp: false }],
    );
    const { d, s } = repos(fake);
    const fu = {
      deliveryDays: 7,
      deliveryDaysType: 'working',
      shippingConditionId: ID.ship,
      invoiceAmount: 200,
    };
    await d.completeRevision(ID.pr, ID.u1, fu);
    await s.completeRevision(ID.pr, ID.u1, fu);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S12-rp: complete-revision из approved на ОМТС-РП эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(
      fake,
      {
        current_stage: null,
        status_id: ID.stRevision,
        previous_status_id: ID.stApproved,
        request_type: 'contractor',
        site_id: ID.siteRp,
        omts_approved_at: '2026-02-01T00:00:00Z',
      },
      [
        { id: ID.d1, stage_order: 2, department_id: 'omts', status: 'approved', is_omts_rp: false },
        { id: ID.d2, stage_order: 2, department_id: 'omts', status: 'approved', is_omts_rp: true },
      ],
    );
    const { d, s } = repos(fake);
    const fu = {
      deliveryDays: 7,
      deliveryDaysType: 'working',
      shippingConditionId: ID.ship,
      invoiceAmount: 100,
    };
    await d.completeRevision(ID.pr, ID.u1, fu);
    await s.completeRevision(ID.pr, ID.u1, fu);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S12-auto: complete-revision из approved для авто-типа эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(
      fake,
      {
        current_stage: null,
        status_id: ID.stRevision,
        previous_status_id: ID.stApproved,
        request_type: 'contractor_work',
        invoice_amount: 100,
      },
      [],
    );
    const { d, s } = repos(fake);
    const fu = {
      deliveryDays: 7,
      deliveryDaysType: 'working',
      shippingConditionId: ID.ship,
      invoiceAmount: 200,
    };
    await d.completeRevision(ID.pr, ID.u1, fu);
    await s.completeRevision(ID.pr, ID.u1, fu);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S13: create-decision (только решение, без продвижения) эквивалентно', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    await seedScenario(fake, { current_stage: 2, status_id: ID.stOmts }, [
      { id: ID.d2, stage_order: 2, department_id: 'omts', status: 'pending' },
    ]);
    const { d, s } = repos(fake);
    const input = {
      paymentRequestId: ID.pr,
      department: 'omts',
      action: 'approve' as const,
      comment: 'ok',
      userId: ID.u1,
      isAdmin: false,
    };
    await d.createDecisionOnly(input);
    await s.createDecisionOnly(input);
    expect(await readDrizzle()).toEqual(readFake(fake));
  });

  it('S14: гонка «доработка → согласовать(блок) → доработано → согласовать» не залипает и эквивалентна', async () => {
    const fake = new FakeSupabase();
    await seedRefs(fake);
    // Заявка на стадии ОМТС с живым pending-решением и заданной суммой (для истории сумм).
    await seedScenario(fake, { current_stage: 2, status_id: ID.stOmts, invoice_amount: 100 }, [
      { id: ID.d2, stage_order: 2, department_id: 'omts', status: 'pending' },
    ]);
    const { d, s } = repos(fake);
    const approve = {
      paymentRequestId: ID.pr,
      department: 'omts',
      action: 'approve' as const,
      comment: 'ок',
      userId: ID.u1,
      isAdmin: false,
    };
    const fu = {
      deliveryDays: 7,
      deliveryDaysType: 'working',
      shippingConditionId: ID.ship,
      invoiceAmount: 200,
    };

    // 1) На доработку
    await d.sendToRevision(ID.pr, ID.u1, 'дешевле');
    await s.sendToRevision(ID.pr, ID.u1, 'дешевле');

    // 2) Согласование во время доработки запрещено в обоих реализациях, стейт не меняется
    const dBlocked = await d.decide(approve);
    const sBlocked = await s.decide(approve);
    expect(dBlocked.ok).toBe(false);
    expect(sBlocked.ok).toBe(false);
    const afterBlock = await readDrizzle();
    expect(afterBlock).toEqual(readFake(fake));
    expect(afterBlock.status_id).toBe(ID.stRevision);
    expect(afterBlock.decisions.some((x) => x.status === 'pending')).toBe(true);

    // 3) Доработано → возврат на стадию ОМТС, previous_status_id очищается
    await d.completeRevision(ID.pr, ID.u1, fu);
    await s.completeRevision(ID.pr, ID.u1, fu);

    // 4) Теперь согласование проходит и заявка штатно уходит в approved (сайт не РП)
    const dOk = await d.decide(approve);
    const sOk = await s.decide(approve);
    expect(dOk.ok).toBe(true);
    expect(sOk.ok).toBe(true);
    const finalState = await readDrizzle();
    expect(finalState).toEqual(readFake(fake));
    expect(finalState.status_id).toBe(ID.stApproved);
    expect(finalState.previous_status_id).toBeNull();
    expect(finalState.decisions.every((x) => x.status === 'approved')).toBe(true);
  });
});
