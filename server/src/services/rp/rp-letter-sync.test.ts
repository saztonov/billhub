/**
 * Тесты syncRpLetter — идемпотентная синхронизация письма РП с PayHub.
 * Все зависимости — фейки (без сети/БД/BullMQ), по образцу payhub-client.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { syncRpLetter, validateShareUrl, rpLetterExternalRef } from './rp-letter-sync.js';
import type { RpLetterSyncDeps, RpLetterSyncRepo } from './rp-letter-sync.js';
import { PayHubApiError } from '../payhub/payhub-errors.js';
import type { PayHubClient } from '../payhub/payhub-client.js';
import type {
  RpLetterSyncContext,
  RpLetterSyncedResult,
  RpLetterSyncStatus,
} from '../../repositories/rp.repository.js';
import type { RpSenderSetting } from './rp-sender-setting.js';

const RP_ID = '11111111-1111-4111-8111-111111111111';
const BASE_URL = 'https://payhub.example.ru';

/** Заглушка pino-логгера */
const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

/** Контекст РП по умолчанию (полностью сопоставленный объект) */
function makeCtx(overrides: Partial<RpLetterSyncContext> = {}): RpLetterSyncContext {
  return {
    id: RP_ID,
    number: 'РП-000123',
    letterDate: '2026-07-04',
    payload: { subject: 'РП', content: '100 ₽, ООО Ромашка', responsiblePersonName: 'Иванов И.И.' },
    payhubLetterId: null,
    payhubLetterUrl: null,
    payhubLetterStatus: 'pending',
    sitePayhubProjectId: 12,
    sitePayhubContractorId: '345',
    attachments: [],
    ...overrides,
  };
}

/** Фейковый репозиторий: пишет вызовы в поля */
function makeRepo(ctx: RpLetterSyncContext | null): RpLetterSyncRepo & {
  statusCalls: Array<{ status: RpLetterSyncStatus; error: string | null }>;
  linked: RpLetterSyncedResult | null;
  synced: RpLetterSyncedResult | null;
  attempts: number;
  attachmentIds: Record<string, string>;
} {
  return {
    statusCalls: [],
    linked: null,
    synced: null,
    attempts: 0,
    attachmentIds: {},
    async getLetterSyncContext() {
      return ctx;
    },
    async recordLetterSyncAttempt() {
      this.attempts += 1;
    },
    async setLetterSyncStatus(_id, status, error) {
      this.statusCalls.push({ status, error: error ?? null });
    },
    async setLetterLinked(_id, result) {
      this.linked = result;
    },
    async setLetterSynced(_id, result) {
      this.synced = result;
    },
    async setAttachmentPayhubId(attachmentId, payhubAttachmentId) {
      this.attachmentIds[attachmentId] = payhubAttachmentId;
    },
  };
}

/** Фейковый PayHub-клиент: lookup 404, createLetter успешен */
function makePayhub(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    baseUrl: BASE_URL,
    lookupLetter: vi.fn().mockRejectedValue(new PayHubApiError(404, 'not_found', 'не найдено')),
    getLetter: vi.fn(),
    shareLetter: vi.fn().mockResolvedValue({ share_url: `${BASE_URL}/letter-share/abc` }),
    createLetter: vi.fn().mockResolvedValue({
      letter: { id: 'L-1', reg_number: 'SU10-ИСХ-2607-0001' },
      share: { share_url: `${BASE_URL}/letter-share/abc` },
    }),
    listAttachments: vi.fn().mockResolvedValue([]),
    uploadAttachment: vi.fn().mockResolvedValue({ id: 'A-1' }),
    ...overrides,
  };
  return client as unknown as PayHubClient & typeof client;
}

const sender: RpSenderSetting = { contractorId: '77', name: 'ООО «СУ-10»', inn: '7736255508' };

function makeDeps(
  repo: RpLetterSyncRepo,
  payhub: PayHubClient | null,
  overrides: Partial<RpLetterSyncDeps> = {},
): RpLetterSyncDeps {
  return {
    repo,
    payhub,
    getSender: async () => sender,
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('file-bytes')),
    log,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncRpLetter — happy path', () => {
  it('создаёт исходящее письмо с проектом/участниками/external_ref и пишет synced', async () => {
    const repo = makeRepo(makeCtx());
    const payhub = makePayhub();
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(outcome).toBe('synced');
    expect(repo.attempts).toBe(1);
    expect(payhub.createLetter).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        project_id: 12,
        direction: 'outgoing',
        letter_date: '2026-07-04',
        number: 'РП-000123',
        subject: 'РП',
        content: '100 ₽, ООО Ромашка',
        responsible_person_name: 'Иванов И.И.',
        sender_type: 'contractor',
        sender_contractor_id: 77,
        recipient_type: 'contractor',
        recipient_contractor_id: 345,
        external_ref: rpLetterExternalRef(RP_ID),
        ensure_share: true,
      }),
    );
    expect(repo.synced).toEqual({
      payhubLetterId: 'L-1',
      payhubLetterRegNumber: 'SU10-ИСХ-2607-0001',
      payhubLetterUrl: `${BASE_URL}/letter-share/abc`,
    });
    // Привязка письма зафиксирована ДО вложений (устойчивость к сбою на их этапе).
    expect(repo.linked).toEqual(repo.synced);
  });

  it('загружает вложения и проставляет payhub_attachment_id', async () => {
    const repo = makeRepo(
      makeCtx({
        attachments: [
          {
            id: 'att-1',
            fileKey: `rp-letters/${RP_ID}/1_a.pdf`,
            fileName: 'a.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 10,
            payhubAttachmentId: null,
          },
        ],
      }),
    );
    const payhub = makePayhub();
    await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(payhub.uploadAttachment).toHaveBeenCalledExactlyOnceWith(
      'L-1',
      expect.objectContaining({ name: 'a.pdf', description: 'billhub:att:att-1' }),
    );
    expect(repo.attachmentIds['att-1']).toBe('A-1');
  });
});

describe('syncRpLetter — идемпотентность', () => {
  it('усыновляет письмо, найденное по external_ref, без createLetter', async () => {
    const repo = makeRepo(makeCtx());
    const payhub = makePayhub({
      lookupLetter: vi.fn().mockResolvedValue({
        letter: { id: 'L-9', reg_number: 'REG-9' },
        share: { share_url: `${BASE_URL}/letter-share/xyz` },
      }),
    });
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(outcome).toBe('synced');
    expect(payhub.createLetter).not.toHaveBeenCalled();
    expect(repo.synced?.payhubLetterId).toBe('L-9');
  });

  it('уже привязанное письмо (payhub_letter_id) повторно не ищет и не создаёт', async () => {
    const repo = makeRepo(
      makeCtx({ payhubLetterId: 'L-5', payhubLetterUrl: `${BASE_URL}/letter-share/old` }),
    );
    const payhub = makePayhub({
      getLetter: vi.fn().mockResolvedValue({ id: 'L-5', reg_number: 'REG-5' }),
    });
    await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(payhub.lookupLetter).not.toHaveBeenCalled();
    expect(payhub.createLetter).not.toHaveBeenCalled();
    expect(repo.synced?.payhubLetterId).toBe('L-5');
    // Существующая ссылка сохранена (share не перезапрашивался).
    expect(repo.synced?.payhubLetterUrl).toBe(`${BASE_URL}/letter-share/old`);
  });

  it('409 при создании -> повторный lookup и усыновление', async () => {
    const repo = makeRepo(makeCtx());
    const lookupLetter = vi
      .fn()
      .mockRejectedValueOnce(new PayHubApiError(404, 'not_found', 'не найдено'))
      .mockResolvedValueOnce({ letter: { id: 'L-7', reg_number: 'REG-7' } });
    const payhub = makePayhub({
      lookupLetter,
      createLetter: vi
        .fn()
        .mockRejectedValue(new PayHubApiError(409, 'unknown', 'external_ref_conflict')),
    });
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(outcome).toBe('synced');
    expect(repo.synced?.payhubLetterId).toBe('L-7');
  });

  it('дедуп вложения по метке в description при повторе', async () => {
    const repo = makeRepo(
      makeCtx({
        payhubLetterId: 'L-1',
        payhubLetterUrl: `${BASE_URL}/letter-share/abc`,
        attachments: [
          {
            id: 'att-1',
            fileKey: 'k',
            fileName: 'a.pdf',
            mimeType: null,
            sizeBytes: 10,
            payhubAttachmentId: null,
          },
        ],
      }),
    );
    const payhub = makePayhub({
      getLetter: vi.fn().mockResolvedValue({ id: 'L-1', reg_number: 'REG-1' }),
      listAttachments: vi.fn().mockResolvedValue([{ id: 'A-9', description: 'billhub:att:att-1' }]),
    });
    await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(payhub.uploadAttachment).not.toHaveBeenCalled();
    expect(repo.attachmentIds['att-1']).toBe('A-9');
  });
});

describe('syncRpLetter — переходный период и ошибки конфигурации PayHub', () => {
  it('createLetter 400 (external_ref не поддержан) -> повтор без external_ref, synced', async () => {
    const repo = makeRepo(makeCtx());
    const createLetter = vi
      .fn()
      .mockRejectedValueOnce(
        new PayHubApiError(400, 'validation_error', 'unknown field external_ref'),
      )
      .mockResolvedValueOnce({
        letter: { id: 'L-2', reg_number: 'REG-2' },
        share: { share_url: `${BASE_URL}/letter-share/z` },
      });
    const payhub = makePayhub({ createLetter });
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(outcome).toBe('synced');
    expect(createLetter).toHaveBeenCalledTimes(2);
    // Первый вызов — с external_ref, второй (fallback) — без него.
    expect(createLetter.mock.calls[0]?.[0]).toHaveProperty('external_ref');
    expect(createLetter.mock.calls[1]?.[0]?.external_ref).toBeUndefined();
    expect(repo.synced?.payhubLetterId).toBe('L-2');
  });

  it('createLetter 403 insufficient_scope -> waiting_config (без расхода ретраев)', async () => {
    const repo = makeRepo(makeCtx());
    const payhub = makePayhub({
      createLetter: vi
        .fn()
        .mockRejectedValue(
          new PayHubApiError(403, 'insufficient_scope', 'нет scope letters:write'),
        ),
    });
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);
    expect(outcome).toBe('waiting_config');
    expect(repo.statusCalls.at(-1)?.status).toBe('waiting_config');
    expect(repo.synced).toBeNull();
  });

  it('share 403 -> мягкая деградация: письмо synced без URL', async () => {
    const repo = makeRepo(makeCtx());
    const payhub = makePayhub({
      createLetter: vi.fn().mockResolvedValue({ letter: { id: 'L-3', reg_number: 'REG-3' } }),
      shareLetter: vi
        .fn()
        .mockRejectedValue(
          new PayHubApiError(403, 'insufficient_scope', 'нет scope letters:share'),
        ),
    });
    const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);
    expect(outcome).toBe('synced');
    expect(repo.synced?.payhubLetterId).toBe('L-3');
    expect(repo.synced?.payhubLetterUrl).toBeNull();
  });

  it('дедуп: одинаковые имя+размер не схлопываются (чужая метка billhub:att: игнорируется)', async () => {
    const repo = makeRepo(
      makeCtx({
        payhubLetterId: 'L-1',
        payhubLetterUrl: `${BASE_URL}/letter-share/abc`,
        attachments: [
          {
            id: 'a1',
            fileKey: 'k1',
            fileName: 'dup.pdf',
            mimeType: null,
            sizeBytes: 10,
            payhubAttachmentId: null,
          },
          {
            id: 'a2',
            fileKey: 'k2',
            fileName: 'dup.pdf',
            mimeType: null,
            sizeBytes: 10,
            payhubAttachmentId: null,
          },
        ],
      }),
    );
    const payhub = makePayhub({
      getLetter: vi.fn().mockResolvedValue({ id: 'L-1', reg_number: 'REG-1' }),
      // a1 уже загружен (со своей меткой); a2 не должен схлопнуться в него по имени+размеру.
      listAttachments: vi
        .fn()
        .mockResolvedValue([
          { id: 'A-1', original_name: 'dup.pdf', size_bytes: 10, description: 'billhub:att:a1' },
        ]),
      uploadAttachment: vi.fn().mockResolvedValue({ id: 'A-2' }),
    });
    await syncRpLetter(makeDeps(repo, payhub), RP_ID);

    expect(repo.attachmentIds['a1']).toBe('A-1'); // усыновлён по своей метке
    expect(payhub.uploadAttachment).toHaveBeenCalledTimes(1); // a2 реально загружен
    expect(repo.attachmentIds['a2']).toBe('A-2');
  });
});

describe('syncRpLetter — ожидание конфигурации (без расхода ретраев)', () => {
  const cases: Array<{ name: string; deps: (repo: RpLetterSyncRepo) => RpLetterSyncDeps }> = [
    {
      name: 'интеграция не настроена (payhub=null)',
      deps: (repo) => makeDeps(repo, null),
    },
    {
      name: 'отправитель не настроен',
      deps: (repo) => makeDeps(repo, makePayhub(), { getSender: async () => null }),
    },
    {
      name: 'ID отправителя не числовой',
      deps: (repo) =>
        makeDeps(repo, makePayhub(), {
          getSender: async () => ({ contractorId: 'abc', name: null, inn: null }),
        }),
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const repo = makeRepo(makeCtx());
      const outcome = await syncRpLetter(c.deps(repo), RP_ID);
      expect(outcome).toBe('waiting_config');
      expect(repo.statusCalls.at(-1)?.status).toBe('waiting_config');
      expect(repo.synced).toBeNull();
    });
  }

  it('объект не сопоставлен с проектом/заказчиком', async () => {
    for (const ctxOverride of [
      { sitePayhubProjectId: null },
      { sitePayhubContractorId: null },
      { sitePayhubContractorId: 'не-число' },
    ]) {
      const repo = makeRepo(makeCtx(ctxOverride));
      const payhub = makePayhub();
      const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);
      expect(outcome).toBe('waiting_config');
      expect(payhub.createLetter).not.toHaveBeenCalled();
    }
  });
});

describe('syncRpLetter — ошибки и пропуски', () => {
  it('временная ошибка PayHub пробрасывается (ретрай BullMQ)', async () => {
    const repo = makeRepo(makeCtx());
    const payhub = makePayhub({
      createLetter: vi.fn().mockRejectedValue(new PayHubApiError(500, 'unknown', 'внутренняя')),
    });
    await expect(syncRpLetter(makeDeps(repo, payhub), RP_ID)).rejects.toThrow('внутренняя');
    expect(repo.synced).toBeNull();
  });

  it('сбой одного вложения: письмо привязано, ошибка проброшена', async () => {
    const repo = makeRepo(
      makeCtx({
        attachments: [
          {
            id: 'a1',
            fileKey: 'k1',
            fileName: 'f1.pdf',
            mimeType: null,
            sizeBytes: 1,
            payhubAttachmentId: null,
          },
          {
            id: 'a2',
            fileKey: 'k2',
            fileName: 'f2.pdf',
            mimeType: null,
            sizeBytes: 2,
            payhubAttachmentId: null,
          },
        ],
      }),
    );
    const payhub = makePayhub({
      uploadAttachment: vi
        .fn()
        .mockResolvedValueOnce({ id: 'A-1' })
        .mockRejectedValueOnce(new Error('сеть')),
    });
    await expect(syncRpLetter(makeDeps(repo, payhub), RP_ID)).rejects.toThrow('f2.pdf');
    // Письмо привязано до вложений; успешное вложение зафиксировано.
    expect(repo.linked?.payhubLetterId).toBe('L-1');
    expect(repo.attachmentIds['a1']).toBe('A-1');
    expect(repo.synced).toBeNull();
  });

  it('статусы synced/uploading и отсутствие payload — задача пропускается', async () => {
    for (const ctx of [
      makeCtx({ payhubLetterStatus: 'synced' }),
      makeCtx({ payhubLetterStatus: 'uploading' }),
      makeCtx({ payload: null }),
      null,
    ]) {
      const repo = makeRepo(ctx);
      const payhub = makePayhub();
      const outcome = await syncRpLetter(makeDeps(repo, payhub), RP_ID);
      expect(outcome).toBe('skipped');
      expect(payhub.createLetter).not.toHaveBeenCalled();
    }
  });
});

describe('validateShareUrl', () => {
  it('принимает ссылку с origin PayHub', () => {
    expect(validateShareUrl(`${BASE_URL}/letter-share/t`, BASE_URL)).toBe(
      `${BASE_URL}/letter-share/t`,
    );
  });
  it('принимает другой публичный origin (PAYHUB_PUBLIC_URL != PAYHUB_BASE_URL)', () => {
    // Origin намеренно НЕ сверяется: PayHub строит share_url из отдельного PAYHUB_PUBLIC_URL.
    expect(validateShareUrl('https://payhub.host/letter-share/t', BASE_URL)).toBe(
      'https://payhub.host/letter-share/t',
    );
  });
  it('резолвит относительную ссылку относительно baseUrl', () => {
    expect(validateShareUrl('/letter-share/t', BASE_URL)).toBe(`${BASE_URL}/letter-share/t`);
  });
  it('отклоняет javascript:, слишком длинную ссылку и undefined', () => {
    // eslint-disable-next-line no-script-url
    expect(validateShareUrl('javascript:alert(1)', BASE_URL)).toBeNull();
    expect(validateShareUrl(`${BASE_URL}/${'a'.repeat(2100)}`, BASE_URL)).toBeNull();
    expect(validateShareUrl(undefined, BASE_URL)).toBeNull();
  });
});
