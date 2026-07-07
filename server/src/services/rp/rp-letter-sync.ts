/**
 * Синхронизация письма РП с PayHub — бизнес-логика задачи BullMQ-воркера.
 * Зависимости инжектируются (тестируемость без Fastify/BullMQ/сети).
 *
 * Идемпотентность:
 *   - письмо ищется по external_ref = billhub:rp:<uuid РП> (lookup) перед созданием;
 *   - уже привязанное письмо (payhub_letter_id в БД) повторно не создаётся;
 *   - вложения дедуплицируются по сохранённому payhub_attachment_id, затем по метке
 *     billhub:att:<uuid> в description, затем по имени+размеру.
 *
 * Разделение ошибок:
 *   - состояния ожидания конфигурации (интеграция не настроена, отправитель не выбран,
 *     объект не сопоставлен) => статус waiting_config, задача завершается УСПЕШНО
 *     (retry-попытки не расходуются; sweep переставит задачу позже);
 *   - временные ошибки (сеть, 5xx PayHub) => исключение => ретрай BullMQ с backoff.
 */
import type { Logger } from 'pino';
import type { PayHubClient } from '../payhub/payhub-client.js';
import { PayHubApiError } from '../payhub/payhub-errors.js';
import type { PayHubLetter, PayHubShare } from '../payhub/payhub-types.js';
import type {
  RpLetterSyncContext,
  RpLetterSyncedResult,
  RpLetterSyncStatus,
} from '../../repositories/rp.repository.js';
import type { RpSenderSetting } from './rp-sender-setting.js';

/** Префикс внешнего ключа идемпотентности письма */
export function rpLetterExternalRef(rpLetterId: string): string {
  return `billhub:rp:${rpLetterId}`;
}

/** Метка вложения BillHub в description вложения PayHub (дедуп при повторе) */
export function rpAttachmentMark(attachmentId: string): string {
  return `billhub:att:${attachmentId}`;
}

/** Подмножество репозитория, нужное синхронизации */
export interface RpLetterSyncRepo {
  getLetterSyncContext(rpLetterId: string): Promise<RpLetterSyncContext | null>;
  recordLetterSyncAttempt(rpLetterId: string): Promise<void>;
  setLetterSyncStatus(
    rpLetterId: string,
    status: RpLetterSyncStatus,
    error?: string | null,
  ): Promise<void>;
  setLetterLinked(rpLetterId: string, result: RpLetterSyncedResult): Promise<void>;
  setLetterSynced(rpLetterId: string, result: RpLetterSyncedResult): Promise<void>;
  setAttachmentPayhubId(attachmentId: string, payhubAttachmentId: string): Promise<void>;
}

/** Зависимости синхронизации */
export interface RpLetterSyncDeps {
  repo: RpLetterSyncRepo;
  /** null — интеграция не настроена (waiting_config) */
  payhub: PayHubClient | null;
  /** Настройка «Отправитель РП» из администрирования */
  getSender: () => Promise<RpSenderSetting | null>;
  /** Скачивание файла вложения из billhub S3 */
  downloadFile: (fileKey: string) => Promise<Buffer>;
  log: Logger;
}

/** Результат: synced — письмо готово; waiting_config — ждём настройку; skipped — синхронизировать нечего */
export type RpLetterSyncOutcome = 'synced' | 'waiting_config' | 'skipped';

/**
 * Валидация share-ссылки из ответа PayHub: протокол http/https и разумная длина.
 * Origin НЕ сверяется с PAYHUB_BASE_URL: PayHub строит share_url из независимой
 * переменной PAYHUB_PUBLIC_URL (публичный хост приложения), которая может отличаться
 * от API-хоста интеграции — жёсткая сверка молча теряла бы валидные ссылки.
 * Относительные ссылки резолвятся относительно baseUrl.
 */
export function validateShareUrl(url: string | undefined, baseUrl: string): string | null {
  if (!url || url.length > 2048) return null;
  try {
    const parsed = new URL(url, baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Ошибка конфигурации — не ретраится, переводит письмо в waiting_config */
class WaitingConfigError extends Error {}

/**
 * Постоянные (неповторяемые) конфигурационные ошибки PayHub: недостаточный scope,
 * запрещённый проект, невалидный/просроченный ключ. Ретраи их не разрешат — переводим
 * письмо в waiting_config (sweep возобновит после исправления настройки/ключа).
 */
function isConfigError(error: unknown): error is PayHubApiError {
  if (!(error instanceof PayHubApiError)) return false;
  if (error.status === 401) return true;
  return (
    error.status === 403 &&
    (error.code === 'insufficient_scope' ||
      error.code === 'forbidden_project' ||
      error.code === 'api_key_invalid' ||
      error.code === 'api_key_expired')
  );
}

/**
 * Создание письма с переходным fallback: если PayHub ещё не поддерживает external_ref
 * (strict-схема отвергает поле, HTTP 400 validation_error), повторяем БЕЗ external_ref.
 * Идемпотентность при этом держится на payhub_letter_id (пишется сразу после создания),
 * а не на external_ref, поэтому дублей не будет. Прочие 4xx пробрасываются.
 */
async function createLetterOnce(
  payhub: PayHubClient,
  body: Parameters<PayHubClient['createLetter']>[0],
  log: Logger,
): Promise<Awaited<ReturnType<PayHubClient['createLetter']>>> {
  try {
    return await payhub.createLetter(body);
  } catch (error) {
    if (
      error instanceof PayHubApiError &&
      error.status === 400 &&
      body.external_ref !== undefined
    ) {
      log.warn(
        { code: error.code },
        'PayHub: создание письма отклонено (возможно, external_ref не поддерживается) — повтор без external_ref',
      );
      const { external_ref: _omit, ...withoutRef } = body;
      return payhub.createLetter(withoutRef);
    }
    throw error;
  }
}

/** Идемпотентный запрос share-ссылки; при 403 insufficient_scope — мягкая деградация (null). */
async function safeShare(
  payhub: PayHubClient,
  letterId: string,
  log: Logger,
): Promise<PayHubShare | undefined> {
  try {
    return await payhub.shareLetter(letterId);
  } catch (error) {
    if (error instanceof PayHubApiError && error.status === 403) {
      log.warn(
        { letterId, code: error.code },
        'PayHub: share недоступен (scope) — письмо без ссылки',
      );
      return undefined;
    }
    throw error;
  }
}

/** Проверки конфигурации; возвращает данные для создания письма */
async function resolveConfig(
  deps: RpLetterSyncDeps,
  ctx: RpLetterSyncContext,
): Promise<{ payhub: PayHubClient; senderId: number; recipientId: number; projectId: number }> {
  if (!deps.payhub) {
    throw new WaitingConfigError(
      'Интеграция PayHub не настроена (PAYHUB_BASE_URL/PAYHUB_API_TOKEN)',
    );
  }
  const sender = await deps.getSender();
  if (!sender) {
    throw new WaitingConfigError('Отправитель РП не настроен (Администрирование -> PayHub)');
  }
  const senderId = Number(sender.contractorId);
  if (!Number.isInteger(senderId) || senderId <= 0) {
    throw new WaitingConfigError(`ID отправителя РП не числовой: "${sender.contractorId}"`);
  }
  if (ctx.sitePayhubProjectId == null) {
    throw new WaitingConfigError('Объект строительства не сопоставлен с проектом PayHub');
  }
  if (!ctx.sitePayhubContractorId) {
    throw new WaitingConfigError('Объект строительства не сопоставлен с заказчиком PayHub');
  }
  const recipientId = Number(ctx.sitePayhubContractorId);
  if (!Number.isInteger(recipientId) || recipientId <= 0) {
    throw new WaitingConfigError(
      `ID заказчика объекта не числовой: "${ctx.sitePayhubContractorId}"`,
    );
  }
  return { payhub: deps.payhub, senderId, recipientId, projectId: ctx.sitePayhubProjectId };
}

/** Поиск существующего письма по external_ref (идемпотентность). null — не найдено. */
async function lookupExisting(
  payhub: PayHubClient,
  externalRef: string,
  log: Logger,
): Promise<{ letter: PayHubLetter; share?: PayHubShare } | null> {
  try {
    return await payhub.lookupLetter({ external_ref: externalRef });
  } catch (error) {
    if (error instanceof PayHubApiError && error.status === 404) return null;
    if (error instanceof PayHubApiError && error.status === 400) {
      // Переходный период: PayHub ещё без поддержки external_ref — считаем «не найдено».
      log.warn({ externalRef }, 'PayHub: lookup по external_ref не поддерживается (HTTP 400)');
      return null;
    }
    throw error;
  }
}

/**
 * Выравнивает номер письма PayHub с рег.номером: на PayHub «Номер письма» (number) и
 * «Рег.номер» (reg_number) должны совпадать — оба берут сгенерированный PayHub номер.
 * Идемпотентно (PATCH только при рассинхроне). Best-effort: сбой правки номера (косметика)
 * не срывает синхронизацию — на следующем проходе (ветка «уже привязано») номер выровняется.
 */
async function normalizeLetterNumber(
  payhub: PayHubClient,
  letter: PayHubLetter,
  log: Logger,
): Promise<PayHubLetter> {
  const reg = letter.reg_number;
  if (!reg || letter.number === reg) return letter;
  try {
    await payhub.updateLetter(letter.id, { number: reg });
  } catch (error) {
    log.warn(
      { letterId: letter.id, err: error },
      'PayHub: не удалось выровнять number=reg_number (повтор на следующей синхронизации)',
    );
  }
  // Источник правды — письмо из create/lookup/get; PATCH меняет только number на PayHub.
  return { ...letter, number: reg };
}

/**
 * Находит письмо (lookup/усыновление) либо создаёт новое, затем выравнивает его номер
 * с рег.номером (normalizeLetterNumber). Возвращает письмо + share.
 */
async function ensureLetter(
  deps: RpLetterSyncDeps,
  ctx: RpLetterSyncContext,
  cfg: { payhub: PayHubClient; senderId: number; recipientId: number; projectId: number },
): Promise<{ letter: PayHubLetter; share?: PayHubShare }> {
  const resolved = await resolveLetter(deps, ctx, cfg);
  const letter = await normalizeLetterNumber(cfg.payhub, resolved.letter, deps.log);
  return { letter, share: resolved.share };
}

/** Находит письмо (lookup/усыновление) либо создаёт новое; возвращает письмо + share */
async function resolveLetter(
  deps: RpLetterSyncDeps,
  ctx: RpLetterSyncContext,
  cfg: { payhub: PayHubClient; senderId: number; recipientId: number; projectId: number },
): Promise<{ letter: PayHubLetter; share?: PayHubShare }> {
  const { payhub } = cfg;
  const externalRef = rpLetterExternalRef(ctx.id);

  // Уже привязано в БД (повтор после сбоя на шаге вложений/записи) — только share.
  if (ctx.payhubLetterId) {
    const letter = await payhub.getLetter(ctx.payhubLetterId);
    const share = ctx.payhubLetterUrl
      ? undefined
      : await safeShare(payhub, ctx.payhubLetterId, deps.log);
    return { letter, share };
  }

  const found = await lookupExisting(payhub, externalRef, deps.log);
  if (found) {
    deps.log.info(
      { rpLetterId: ctx.id, payhubLetterId: found.letter.id },
      'RP-письмо усыновлено по external_ref',
    );
    const share = found.share ?? (await safeShare(payhub, found.letter.id, deps.log));
    return { letter: found.letter, share };
  }

  const payload = ctx.payload!;
  try {
    return await createLetterOnce(
      payhub,
      {
        project_id: cfg.projectId,
        direction: 'outgoing',
        letter_date: ctx.letterDate ?? new Date().toISOString().slice(0, 10),
        // Локальный номер РП не отправляем: PayHub генерирует номер сам, затем мы
        // выравниваем number = reg_number (normalizeLetterNumber). Оба поля совпадают.
        subject: payload.subject,
        content: payload.content,
        responsible_person_name: payload.responsiblePersonName ?? undefined,
        sender_type: 'contractor',
        sender_contractor_id: cfg.senderId,
        recipient_type: 'contractor',
        recipient_contractor_id: cfg.recipientId,
        external_ref: externalRef,
        ensure_share: true,
      },
      deps.log,
    );
  } catch (error) {
    // Гонка/повтор: письмо с этим external_ref уже создано — усыновляем.
    if (error instanceof PayHubApiError && error.status === 409) {
      const existing = await lookupExisting(payhub, externalRef, deps.log);
      if (existing) {
        const share = existing.share ?? (await safeShare(payhub, existing.letter.id, deps.log));
        return { letter: existing.letter, share };
      }
    }
    // Конфигурационная ошибка (scope/проект/ключ) — не жечь ретраи, ждать исправления.
    if (isConfigError(error)) {
      throw new WaitingConfigError(`PayHub: ${error.message}`);
    }
    throw error;
  }
}

/** Дозагрузка вложений к письму (идемпотентно); бросает ошибку, если хоть один файл не ушёл */
async function syncAttachments(
  deps: RpLetterSyncDeps,
  ctx: RpLetterSyncContext,
  payhub: PayHubClient,
  letterId: string,
): Promise<void> {
  const missing = ctx.attachments.filter((a) => !a.payhubAttachmentId);
  if (missing.length === 0) return;

  // Существующие вложения письма — для дедупа при повторе после сбоя записи id.
  const existing = await payhub.listAttachments(letterId);

  // id вложений PayHub, уже привязанные к другим строкам — чтобы одно вложение PayHub
  // не присвоилось двум разным нашим файлам (дедуп по имени+размеру не уникален).
  const takenPayhubIds = new Set(
    ctx.attachments.map((a) => a.payhubAttachmentId).filter((v): v is string => !!v),
  );
  const failures: string[] = [];
  for (const att of missing) {
    const mark = rpAttachmentMark(att.id);
    const already = existing.find((e) => {
      if (takenPayhubIds.has(e.id)) return false;
      // Точное совпадение по нашей метке — надёжный признак «это тот же файл».
      if (e.description === mark) return true;
      // Fallback имя+размер — только для вложений БЕЗ чужой метки billhub:att:
      // (иначе одинаковые файлы могут схлопнуться в одно).
      const hasOtherMark =
        typeof e.description === 'string' && e.description.startsWith('billhub:att:');
      return (
        !hasOtherMark &&
        e.original_name === att.fileName &&
        e.size_bytes != null &&
        e.size_bytes === att.sizeBytes
      );
    });
    if (already) {
      takenPayhubIds.add(already.id);
      await deps.repo.setAttachmentPayhubId(att.id, already.id);
      continue;
    }
    try {
      const bytes = await deps.downloadFile(att.fileKey);
      const uploaded = await payhub.uploadAttachment(letterId, {
        name: att.fileName,
        bytes,
        mime_type: att.mimeType ?? undefined,
        description: mark,
      });
      takenPayhubIds.add(uploaded.id);
      await deps.repo.setAttachmentPayhubId(att.id, uploaded.id);
    } catch (error) {
      deps.log.warn(
        { rpLetterId: ctx.id, attachmentId: att.id, err: error },
        'RP-письмо: вложение не загружено',
      );
      failures.push(att.fileName);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Не загружены вложения: ${failures.join(', ')}`);
  }
}

/**
 * Результат синхронного создания письма (1 этап модалки).
 * sync — письмо создано в PayHub, есть рег.номер и QR; async_fallback — конфигурация
 * не готова (интеграция/отправитель/сопоставление), письмо будет синхронизировано позже.
 */
export type RpLetterStage1Result =
  | {
      mode: 'sync';
      payhubLetterId: string;
      regNumber: string | null;
      url: string | null;
      qrSvgDataUrl: string | null;
    }
  | { mode: 'async_fallback'; reason: string };

/**
 * Синхронное создание письма PayHub для 1 этапа модалки: переиспользует
 * resolveConfig/ensureLetter (создание + share). При готовой конфигурации создаёт
 * письмо, привязывает его к РП (setLetterLinked, статус не меняется — остаётся
 * uploading) и возвращает рег.номер + QR. При неготовой конфигурации возвращает
 * async_fallback (WaitingConfigError), НЕ бросая исключение — вызывающий роут
 * доводит РП старым асинхронным путём. Прочие ошибки пробрасываются (роут откатит РП).
 */
export async function createRpLetterStage1(
  deps: RpLetterSyncDeps,
  rpLetterId: string,
): Promise<RpLetterStage1Result> {
  const ctx = await deps.repo.getLetterSyncContext(rpLetterId);
  if (!ctx) throw new Error(`RP-письмо: РП ${rpLetterId} не найдена при создании письма`);
  if (!ctx.payload) throw new Error(`RP-письмо: у РП ${rpLetterId} нет снимка формы письма`);

  try {
    const cfg = await resolveConfig(deps, ctx);
    const { letter, share } = await ensureLetter(deps, ctx, cfg);
    const shareUrl = validateShareUrl(share?.share_url, cfg.payhub.baseUrl);
    const linked = {
      payhubLetterId: letter.id,
      payhubLetterRegNumber: letter.reg_number ?? null,
      payhubLetterUrl: shareUrl ?? ctx.payhubLetterUrl,
      payhubLetterDate: letter.letter_date ?? null,
    };
    try {
      await deps.repo.setLetterLinked(rpLetterId, linked);
    } catch (linkErr) {
      // Привязка не удалась — иначе письмо осиротело бы в PayHub. Удаляем его (best-effort)
      // и пробрасываем ошибку: роут откатит локальную РП.
      await cfg.payhub
        .deleteLetter(letter.id)
        .catch((delErr) =>
          deps.log.error(
            { err: delErr, payhubLetterId: letter.id },
            'RP-письмо: не удалось удалить осиротевшее письмо после сбоя привязки',
          ),
        );
      throw linkErr;
    }
    return {
      mode: 'sync',
      payhubLetterId: letter.id,
      regNumber: linked.payhubLetterRegNumber,
      url: linked.payhubLetterUrl,
      qrSvgDataUrl: share?.qr_svg_data_url ?? null,
    };
  } catch (error) {
    if (error instanceof WaitingConfigError) {
      return { mode: 'async_fallback', reason: error.message };
    }
    throw error;
  }
}

/**
 * Синхронизация одного письма РП. Возвращает исход; бросает исключение только
 * при временных ошибках (для ретрая BullMQ).
 */
export async function syncRpLetter(
  deps: RpLetterSyncDeps,
  rpLetterId: string,
): Promise<RpLetterSyncOutcome> {
  const ctx = await deps.repo.getLetterSyncContext(rpLetterId);
  if (!ctx) {
    deps.log.warn({ rpLetterId }, 'RP-письмо: РП не найдена — задача пропущена');
    return 'skipped';
  }
  // Идемпотентность и защита от преждевременного запуска.
  // synced пропускаем ТОЛЬКО если нет недогруженных вложений: дозагрузка файлов из
  // редактирования (0013) добавляет вложение без payhub_attachment_id — его надо догрузить,
  // даже если письмо успело вернуться в synced (гонка). syncAttachments грузит лишь недостающие.
  if (ctx.payhubLetterStatus === 'synced') {
    const hasMissingAttachments = ctx.attachments.some((a) => !a.payhubAttachmentId);
    if (!hasMissingAttachments) return 'skipped';
  }
  if (ctx.payhubLetterStatus === 'uploading') {
    deps.log.info({ rpLetterId }, 'RP-письмо: файлы ещё догружаются — задача пропущена');
    return 'skipped';
  }
  if (!ctx.payload) {
    // Письмо не оформлялось (старые РП) — синхронизировать нечего.
    deps.log.warn({ rpLetterId }, 'RP-письмо: нет снимка формы — задача пропущена');
    return 'skipped';
  }

  await deps.repo.recordLetterSyncAttempt(rpLetterId);

  // Ошибки конфигурации (нет отправителя/сопоставления/scope, external_ref не поддержан)
  // из resolveConfig/ensureLetter -> waiting_config без расхода ретраев (возобновит sweep).
  try {
    const cfg = await resolveConfig(deps, ctx);
    const { letter, share } = await ensureLetter(deps, ctx, cfg);

    const shareUrl = validateShareUrl(share?.share_url, cfg.payhub.baseUrl);
    if (share?.share_url && !shareUrl) {
      deps.log.warn(
        { rpLetterId, shareUrl: share.share_url },
        'RP-письмо: share-ссылка не прошла валидацию',
      );
    }
    const linked = {
      payhubLetterId: letter.id,
      payhubLetterRegNumber: letter.reg_number ?? null,
      payhubLetterUrl: shareUrl ?? ctx.payhubLetterUrl,
      payhubLetterDate: letter.letter_date ?? null,
    };
    // Привязываем письмо сразу (статус ещё pending) — повтор после сбоя вложений
    // не будет искать/создавать его заново даже без поддержки external_ref на PayHub.
    await deps.repo.setLetterLinked(rpLetterId, linked);

    await syncAttachments(deps, ctx, cfg.payhub, letter.id);

    await deps.repo.setLetterSynced(rpLetterId, linked);
    deps.log.info(
      { rpLetterId, payhubLetterId: letter.id, regNumber: letter.reg_number },
      'RP-письмо синхронизировано с PayHub',
    );
    return 'synced';
  } catch (error) {
    if (error instanceof WaitingConfigError) {
      await deps.repo.setLetterSyncStatus(rpLetterId, 'waiting_config', error.message);
      deps.log.info({ rpLetterId, reason: error.message }, 'RP-письмо: ожидание конфигурации');
      return 'waiting_config';
    }
    throw error;
  }
}
