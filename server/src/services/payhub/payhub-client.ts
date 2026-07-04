/**
 * Клиент внешнего API PayHub (/api/external/v1).
 *
 * Потребители:
 *   - HTTP-роуты — через fastify.payhub (плагин plugins/payhub.ts);
 *   - BullMQ-воркер и CLI — напрямую через createPayHubClientFromEnv().
 *
 * Модульного синглтона нет: плагин создаёт клиент один раз при регистрации,
 * воркер/CLI — при старте; тесты создают экземпляры с инжектированным fetch.
 */
import { config } from '../../config.js';
import { createObservabilityLogger } from '../observability/logger.js';
import { PayHubHttp } from './payhub-http.js';
import type {
  CreatePayHubLetterInput,
  ListPayHubLettersParams,
  LookupPayHubLetterParams,
  PayHubAttachment,
  PayHubContractor,
  PayHubLetter,
  PayHubLetterCreated,
  PayHubLetterList,
  PayHubLetterLookupResult,
  PayHubLetterStatus,
  PayHubPingResult,
  PayHubPresignResult,
  PayHubProject,
  PayHubShare,
  PresignAttachmentUploadInput,
  RegisterAttachmentInput,
  UpdatePayHubLetterInput,
  UploadAttachmentFileInput,
} from './payhub-types.js';

/** Лимит размера вложения PayHub (300 МБ) */
export const PAYHUB_MAX_ATTACHMENT_BYTES = 300 * 1024 * 1024;
/** Короткий таймаут ping (проверка подключения из админки) */
const PING_TIMEOUT_MS = 5000;
/** Увеличенный таймаут PUT байтов в S3 (файлы до 300 МБ) */
const PUT_BINARY_TIMEOUT_MS = 600_000;

export interface PayHubClientOptions {
  /** Origin PayHub без пути, например https://payhub.example.ru */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Инжектируемый fetch для тестов; по умолчанию глобальный */
  fetchImpl?: typeof fetch;
}

/**
 * Достаёт массив из обёртки ответа PayHub ({projects:[...]}, {letters:[...]} и т.п.).
 * Кандидаты проверяются по порядку; запасной вариант — единственное поле-массив.
 */
function pickArray<T>(payload: unknown, ...candidates: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of candidates) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
    const arrays = Object.values(record).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as T[];
  }
  throw new Error(`PayHub: неожиданный формат ответа (ожидался массив ${candidates.join('/')})`);
}

/** Разворачивает {letter:{...}} либо принимает письмо без обёртки */
function unwrapLetter(payload: unknown): PayHubLetter {
  const record = (payload ?? {}) as Record<string, unknown>;
  const letter = (record.letter ?? record) as PayHubLetter;
  if (!letter || typeof letter !== 'object' || letter.id === undefined) {
    throw new Error('PayHub: неожиданный формат ответа (ожидалось письмо)');
  }
  return letter;
}

/** Типизированный клиент внешнего API PayHub */
export class PayHubClient {
  readonly baseUrl: string;
  private readonly http: PayHubHttp;

  constructor(options: PayHubClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.http = new PayHubHttp({
      baseUrl: this.baseUrl,
      token: options.token,
      timeoutMs: options.timeoutMs ?? config.payhubTimeoutMs,
      fetchImpl: options.fetchImpl ?? fetch,
      logger: createObservabilityLogger('payhub'),
    });
  }

  /* ---------------- Справочники (scope catalog:read) ---------------- */

  async listProjects(): Promise<PayHubProject[]> {
    const payload = await this.http.request<unknown>('GET', '/catalog/projects');
    return pickArray<PayHubProject>(payload, 'projects');
  }

  async listContractors(): Promise<PayHubContractor[]> {
    const payload = await this.http.request<unknown>('GET', '/catalog/contractors');
    return pickArray<PayHubContractor>(payload, 'contractors');
  }

  async listLetterStatuses(): Promise<PayHubLetterStatus[]> {
    const payload = await this.http.request<unknown>('GET', '/catalog/letter-statuses');
    return pickArray<PayHubLetterStatus>(payload, 'letter_statuses', 'statuses');
  }

  /* ---------------- Письма ---------------- */

  /** Создание письма; reg_number генерирует сервер PayHub (scope letters:write) */
  async createLetter(input: CreatePayHubLetterInput): Promise<PayHubLetterCreated> {
    const payload = await this.http.request<Record<string, unknown>>('POST', '/letters', {
      body: input,
    });
    return {
      letter: unwrapLetter(payload),
      share: payload.share as PayHubShare | undefined,
    };
  }

  /** Поиск писем по номеру/рег.номеру (scope letters:read) */
  async listLetters(params: ListPayHubLettersParams = {}): Promise<PayHubLetterList> {
    const payload = await this.http.request<Record<string, unknown>>('GET', '/letters', {
      query: {
        number: params.number,
        reg_number: params.reg_number,
        offset: params.offset,
        limit: params.limit,
      },
    });
    return {
      letters: pickArray<PayHubLetter>(payload, 'letters', 'items', 'data'),
      total: typeof payload?.total === 'number' ? payload.total : undefined,
    };
  }

  /** Одно письмо по id (scope letters:read) */
  async getLetter(id: string): Promise<PayHubLetter> {
    const payload = await this.http.request<unknown>('GET', `/letters/${encodeURIComponent(id)}`);
    return unwrapLetter(payload);
  }

  /** Редактирование СВОЕГО письма; чужое — 403 not_owner (scope letters:write) */
  async updateLetter(id: string, patch: UpdatePayHubLetterInput): Promise<PayHubLetter> {
    const payload = await this.http.request<unknown>(
      'PATCH',
      `/letters/${encodeURIComponent(id)}`,
      { body: patch },
    );
    return unwrapLetter(payload);
  }

  /**
   * Удаление СВОЕГО письма и его вложений (scope letters:write).
   * 204 — успех; 404 not_found — письма нет (для cleanup трактуется как «уже удалено»);
   * 403 not_owner — чужое письмо. Мутация: транспорт не повторяет запрос.
   */
  async deleteLetter(id: string): Promise<void> {
    await this.http.request<void>('DELETE', `/letters/${encodeURIComponent(id)}`);
  }

  /** Ссылка + QR по id письма, идемпотентно (scope letters:share) */
  async shareLetter(id: string): Promise<PayHubShare> {
    const payload = await this.http.request<Record<string, unknown>>(
      'POST',
      `/letters/${encodeURIComponent(id)}/share`,
    );
    return (payload.share ?? payload) as PayHubShare;
  }

  /**
   * Поиск письма по реквизитам (scope letters:read).
   * 404 not_found — не найдено; 409 ambiguous_letter_lookup — уточните project_id.
   * external_ref — точный поиск по внешнему ключу идемпотентности (приоритетнее остальных).
   */
  async lookupLetter(params: LookupPayHubLetterParams): Promise<PayHubLetterLookupResult> {
    const payload = await this.http.request<Record<string, unknown>>('GET', '/letters/lookup', {
      query: {
        reg_number: params.reg_number,
        number: params.number,
        external_ref: params.external_ref,
        project_id: params.project_id,
      },
    });
    return {
      letter: unwrapLetter(payload),
      share: payload.share as PayHubShare | undefined,
    };
  }

  /* ---------------- Вложения ---------------- */

  /** Шаг 1 загрузки: presigned URL для PUT в S3 (scope attachments:write) */
  async presignAttachmentUpload(
    letterId: string,
    input: PresignAttachmentUploadInput,
  ): Promise<PayHubPresignResult> {
    return this.http.request<PayHubPresignResult>(
      'POST',
      `/letters/${encodeURIComponent(letterId)}/attachments/presign-upload`,
      { body: input },
    );
  }

  /** Шаг 2 загрузки: PUT байтов напрямую в S3 (без Bearer, файл мимо BFF PayHub) */
  async uploadToPresignedUrl(
    presign: PayHubPresignResult,
    bytes: Buffer | Uint8Array,
  ): Promise<void> {
    await this.http.putBinary(presign.url, presign.headers ?? {}, bytes, PUT_BINARY_TIMEOUT_MS);
  }

  /** Шаг 3 загрузки: привязка загруженного файла к письму (scope attachments:write) */
  async registerAttachment(
    letterId: string,
    input: RegisterAttachmentInput,
  ): Promise<{ id: string }> {
    return this.http.request<{ id: string }>(
      'POST',
      `/letters/${encodeURIComponent(letterId)}/attachments`,
      { body: input },
    );
  }

  /** Полный цикл загрузки вложения: presign -> PUT в S3 -> привязка к письму */
  async uploadAttachment(
    letterId: string,
    file: UploadAttachmentFileInput,
  ): Promise<{ id: string }> {
    const sizeBytes = file.bytes.byteLength;
    if (sizeBytes > PAYHUB_MAX_ATTACHMENT_BYTES) {
      throw new Error(`PayHub: файл превышает лимит вложения 300 МБ (${sizeBytes} байт)`);
    }
    const presign = await this.presignAttachmentUpload(letterId, {
      file_name: file.name,
      content_type: file.mime_type,
      size_bytes: sizeBytes,
    });
    await this.uploadToPresignedUrl(presign, file.bytes);
    return this.registerAttachment(letterId, {
      original_name: file.name,
      storage_path: presign.storage_path,
      size_bytes: sizeBytes,
      mime_type: file.mime_type,
      description: file.description,
    });
  }

  /** Список вложений письма (scope attachments:read) */
  async listAttachments(letterId: string): Promise<PayHubAttachment[]> {
    const payload = await this.http.request<unknown>(
      'GET',
      `/letters/${encodeURIComponent(letterId)}/attachments`,
    );
    return pickArray<PayHubAttachment>(payload, 'attachments', 'items');
  }

  /** Presigned-ссылка на скачивание вложения (scope attachments:read) */
  async getAttachmentDownloadUrl(attachmentId: string, ttlSec?: number): Promise<{ url: string }> {
    return this.http.request<{ url: string }>(
      'GET',
      `/attachments/${encodeURIComponent(attachmentId)}/download-url`,
      { query: { ttl_sec: ttlSec } },
    );
  }

  /* ---------------- Служебное ---------------- */

  /**
   * Проверка доступности PayHub: самый дешёвый read-only вызов
   * (catalog/letter-statuses), короткий таймаут, без ретраев.
   */
  async ping(): Promise<PayHubPingResult> {
    const startedAt = Date.now();
    await this.http.request<unknown>('GET', '/catalog/letter-statuses', {
      timeoutMs: PING_TIMEOUT_MS,
      retries: 0,
    });
    return { ok: true, latencyMs: Date.now() - startedAt };
  }
}

/** Нормализация baseUrl: валидный http(s)-origin, без трейлинг-слэша и пути */
export function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`PAYHUB_BASE_URL не является корректным URL: "${raw}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`PAYHUB_BASE_URL должен использовать http/https: "${raw}"`);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path !== '') {
    throw new Error(
      `PAYHUB_BASE_URL должен быть origin без пути (например https://payhub.example.ru): "${raw}"`,
    );
  }
  return parsed.origin;
}

/** Чистая фабрика: валидирует baseUrl, бросает ошибку при некорректном */
export function createPayHubClient(options: PayHubClientOptions): PayHubClient {
  return new PayHubClient(options);
}

/**
 * Фабрика из env-конфига. null — интеграция не настроена (валидное состояние).
 * Некорректный PAYHUB_BASE_URL — ошибка конфигурации, бросается при старте.
 */
export function createPayHubClientFromEnv(): PayHubClient | null {
  if (!config.payhubBaseUrl || !config.payhubApiToken) return null;
  return createPayHubClient({
    baseUrl: config.payhubBaseUrl,
    token: config.payhubApiToken,
    timeoutMs: config.payhubTimeoutMs,
  });
}
