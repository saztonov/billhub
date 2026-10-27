/**
 * Drizzle-only интеграционные тесты автосоздания РП при согласовании на этапе «РП» (stage 4):
 * РП со ссылкой на заявку, снимком документов и вложениями письма (файлы заявки без
 * зачёркнутых + договорные + учредительные), выключатель в settings, повторное согласование
 * заявки с РП, сбой создания не откатывает согласование, этапы до РП РП не создают.
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
  paymentRequestFiles,
  approvalDecisions,
  rpStageAssignees,
  suppliers,
  documentTypes,
  contractRequests,
  contractRequestFiles,
  supplierFoundingDocuments,
  foundingDocumentFiles,
  rpLetters,
  rpLetterRequests,
  rpLetterDocuments,
  rpLetterAttachments,
  settings,
} from '../../db/schema/index.js';
import { runMigrations } from '../../cli/migrate.js';
import { DrizzleApprovalRepository } from './approval.drizzle.js';
import { RP_AUTO_CREATE_SETTING_KEY } from '../../services/rp/rp-auto-create-setting.js';

const RUN = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

const ID = {
  cp: '11111111-1111-1111-1111-111111111111',
  site: '22222222-2222-2222-2222-222222222222',
  siteRp: '22222222-2222-2222-2222-2222222222aa',
  ship: '33333333-3333-3333-3333-333333333333',
  omtsUser: '44444444-0000-0000-0000-000000000001',
  rpUser: '44444444-0000-0000-0000-000000000003',
  creator: '44444444-0000-0000-0000-000000000005',
  supplier: '55555555-0000-0000-0000-000000000001',
  stOmts: '66666666-0000-0000-0000-000000000002',
  stRp: '66666666-0000-0000-0000-000000000003',
  stApproved: '66666666-0000-0000-0000-000000000004',
  stContract: '66666666-0000-0000-0000-000000000009',
  pr: '77777777-7777-7777-7777-777777777777',
  docInvoice: '99999999-0000-0000-0000-000000000001',
  docFounding: '99999999-0000-0000-0000-000000000002',
  contract: 'aaaaaaaa-0000-0000-0000-000000000001',
  sfd: 'bbbbbbbb-0000-0000-0000-000000000001',
};

describe.skipIf(!RUN)('Автосоздание РП на этапе «РП» — Drizzle-only', () => {
  let container!: StartedPostgreSqlContainer;
  let sql!: postgres.Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let repo!: DrizzleApprovalRepository;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    await runMigrations({ databaseUrl: url, logger: () => {} });
    sql = postgres(url, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
    repo = new DrizzleApprovalRepository(db);
  }, 180_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE payment_requests, payment_request_files, approval_decisions,
      payment_request_logs, statuses, users, counterparties, construction_sites,
      payment_request_field_options, suppliers, rp_stage_assignees, notifications, document_types,
      contract_requests, contract_request_files, supplier_founding_documents,
      founding_document_files, rp_letters, rp_letter_requests, rp_letter_documents,
      rp_letter_attachments, settings
      RESTART IDENTITY CASCADE`;
    await db.insert(statuses).values([
      ...[
        { id: ID.stOmts, code: 'approv_omts', name: 'ОМТС' },
        { id: ID.stRp, code: 'approv_rp', name: 'На согласовании РП' },
        { id: ID.stApproved, code: 'approved', name: 'Согласована' },
      ].map((s) => ({ ...s, entityType: 'payment_request' })),
      { id: ID.stContract, code: 'signed', name: 'Подписан', entityType: 'contract_request' },
    ]);
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
        id: ID.rpUser,
        email: 'rp@x',
        fullName: 'Иванов И.И.',
        role: 'user',
        departmentId: 'shtab',
      },
      { id: ID.creator, email: 'c@x', fullName: 'Creator', role: 'user' },
    ]);
    await db.insert(rpStageAssignees).values({ constructionSiteId: ID.siteRp, userId: ID.rpUser });
    await db
      .insert(suppliers)
      .values({ id: ID.supplier, name: 'ООО Поставщик', inn: '7707083893' });
    await db.insert(documentTypes).values([
      { id: ID.docInvoice, name: 'Счёт' },
      { id: ID.docFounding, name: 'Устав', category: 'founding' },
    ]);
  });

  async function seedPr(opts: { siteId?: string; currentStage: number; statusId: string }) {
    await db.insert(paymentRequests).values({
      id: ID.pr,
      requestNumber: '0001',
      counterpartyId: ID.cp,
      supplierId: ID.supplier,
      statusId: opts.statusId,
      deliveryDays: 5,
      shippingConditionId: ID.ship,
      createdBy: ID.creator,
      siteId: opts.siteId ?? ID.siteRp,
      currentStage: opts.currentStage,
      omtsApprovedAt: '2026-01-01T00:00:00Z',
      requestType: 'contractor',
      invoiceAmount: 1500,
      comment: 'Бетон',
      stageHistory: [],
      invoiceAmountHistory: [],
    });
    await db.insert(approvalDecisions).values({
      paymentRequestId: ID.pr,
      stageOrder: opts.currentStage,
      departmentId: opts.currentStage === 4 ? 'rp' : 'omts',
      status: 'pending',
      isOmtsRp: false,
    });
  }

  /** Файлы заявки (2 активных + 1 зачёркнутый), договора (1 + 1 зачёркнутый), учредительный. */
  async function seedFiles() {
    const file = (name: string, isRejected = false) => ({
      paymentRequestId: ID.pr,
      documentTypeId: ID.docInvoice,
      fileName: name,
      fileKey: `CP/0001/${name}`,
      fileSize: 100,
      mimeType: 'application/pdf',
      createdBy: ID.creator,
      isRejected,
    });
    await db
      .insert(paymentRequestFiles)
      .values([file('invoice.pdf'), file('act.pdf'), file('old.pdf', true)]);
    await db.insert(contractRequests).values({
      id: ID.contract,
      requestNumber: 'Д-1',
      siteId: ID.siteRp,
      counterpartyId: ID.cp,
      supplierId: ID.supplier,
      partiesCount: 2,
      subjectType: 'concrete',
      statusId: ID.stContract,
      createdBy: ID.creator,
      contractNumber: '15/26',
      contractSigningDate: '2026-02-01',
    });
    await db.insert(contractRequestFiles).values([
      {
        contractRequestId: ID.contract,
        fileName: 'contract.pdf',
        fileKey: 'CP/contracts/contract.pdf',
        createdBy: ID.creator,
      },
      {
        contractRequestId: ID.contract,
        fileName: 'draft.pdf',
        fileKey: 'CP/contracts/draft.pdf',
        createdBy: ID.creator,
        isRejected: true,
      },
    ]);
    await db.insert(supplierFoundingDocuments).values({
      id: ID.sfd,
      supplierId: ID.supplier,
      foundingDocumentTypeId: ID.docFounding,
    });
    await db.insert(foundingDocumentFiles).values({
      supplierFoundingDocumentId: ID.sfd,
      fileName: 'ustav.pdf',
      fileKey: 'founding/ustav.pdf',
      createdBy: ID.creator,
    });
  }

  const approveRp = () =>
    repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.rpUser,
      userDepartment: 'shtab',
      isAdmin: false,
    });

  async function readPr() {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, ID.pr));
    return pr!;
  }

  it('согласование на этапе РП создаёт РП с письмом в pending и всеми файлами', async () => {
    await seedPr({ currentStage: 4, statusId: ID.stRp });
    await seedFiles();

    const res = await approveRp();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.autoRp?.status).toBe('created');
    const rpLetterId = res.autoRp?.status === 'created' ? res.autoRp.rpLetterId : '';

    expect((await readPr()).statusId).toBe(ID.stApproved);

    const [rp] = await db.select().from(rpLetters).where(eq(rpLetters.id, rpLetterId));
    expect(rp).toMatchObject({
      supplierId: ID.supplier,
      counterpartyId: ID.cp,
      siteId: ID.siteRp,
      totalAmount: 1500,
      description: 'Бетон',
      status: 'draft',
      createdBy: ID.rpUser,
      payhubLetterStatus: 'pending',
    });
    expect(rp!.letterDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rp!.payhubLetterPayload).toMatchObject({
      subject: 'РП',
      responsiblePersonName: 'Иванов И.И.',
    });
    expect(rp!.payhubLetterPayload!.content).toContain('ООО Поставщик, Бетон');

    const links = await db
      .select()
      .from(rpLetterRequests)
      .where(eq(rpLetterRequests.rpLetterId, rpLetterId));
    expect(links.map((l) => l.paymentRequestId)).toEqual([ID.pr]);

    const docs = await db
      .select({ source: rpLetterDocuments.source, fileKey: rpLetterDocuments.fileKey })
      .from(rpLetterDocuments)
      .where(eq(rpLetterDocuments.rpLetterId, rpLetterId));
    expect(docs.map((d) => `${d.source}:${d.fileKey}`).sort()).toEqual([
      'contract:CP/contracts/contract.pdf',
      'founding:founding/ustav.pdf',
    ]);

    const atts = await db
      .select({ fileKey: rpLetterAttachments.fileKey, fileType: rpLetterAttachments.fileType })
      .from(rpLetterAttachments)
      .where(eq(rpLetterAttachments.rpLetterId, rpLetterId));
    expect(atts.map((a) => a.fileKey).sort()).toEqual([
      'CP/0001/act.pdf',
      'CP/0001/invoice.pdf',
      'CP/contracts/contract.pdf',
      'founding/ustav.pdf',
    ]);
    expect(atts.every((a) => a.fileType === 'other')).toBe(true);
  });

  it('автосоздание выключено настройкой — РП не создаётся', async () => {
    await db
      .insert(settings)
      .values({ key: RP_AUTO_CREATE_SETTING_KEY, value: { enabled: false } });
    await seedPr({ currentStage: 4, statusId: ID.stRp });

    const res = await approveRp();
    expect(res).toMatchObject({ ok: true, autoRp: { status: 'skipped', reason: 'disabled' } });
    expect(await db.select().from(rpLetters)).toHaveLength(0);
    expect((await readPr()).statusId).toBe(ID.stApproved);
  });

  it('заявка уже в РП (повторное согласование) — ничего не создаётся', async () => {
    await seedPr({ currentStage: 4, statusId: ID.stRp });
    await db.update(paymentRequests).set({ dpNumber: 'SU-ИСХ-2601-0001' });

    const res = await approveRp();
    expect(res).toMatchObject({
      ok: true,
      autoRp: { status: 'skipped', reason: 'already_linked' },
    });
    expect(await db.select().from(rpLetters)).toHaveLength(0);
  });

  it('сбой создания РП не откатывает согласование', async () => {
    await seedPr({ currentStage: 4, statusId: ID.stRp });
    await sql.unsafe(`
      CREATE FUNCTION test_fail_rp() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail_rp BEFORE INSERT ON rp_letters
        FOR EACH ROW EXECUTE FUNCTION test_fail_rp();
    `);
    try {
      const res = await approveRp();
      expect(res).toMatchObject({ ok: true, autoRp: { status: 'failed' } });
      const pr = await readPr();
      expect(pr.statusId).toBe(ID.stApproved);
      expect(pr.approvedAt).toBeTruthy();
      expect(await db.select().from(rpLetters)).toHaveLength(0);
    } finally {
      await sql.unsafe(`
        DROP TRIGGER test_fail_rp ON rp_letters;
        DROP FUNCTION test_fail_rp();
      `);
    }
  });

  it('финальное согласование на этапе ОМТС (объект без назначенца) РП не создаёт', async () => {
    await seedPr({ currentStage: 2, statusId: ID.stOmts, siteId: ID.site });

    const res = await repo.decide({
      paymentRequestId: ID.pr,
      action: 'approve',
      comment: '',
      userId: ID.omtsUser,
      userDepartment: 'omts',
      isAdmin: false,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.autoRp).toBeFalsy();
    expect((await readPr()).statusId).toBe(ID.stApproved);
    expect(await db.select().from(rpLetters)).toHaveLength(0);
  });
});
