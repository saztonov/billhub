/**
 * Клиент публичного API SIGNAL DOCS (api.sgnl.pro) для выгрузки счетов.
 *
 * Потребители:
 *   - HTTP-роуты админки — через fastify.sgnl (плагин plugins/sgnl.ts);
 *   - BullMQ-воркер выгрузки — напрямую через createSgnlClientFromEnv().
 *
 * Два набора scopes: READ (справочники, предпросмотр) и WRITE (загрузка). Предпросмотр
 * работает, даже если интеграции ещё не выдан docs:version:create.
 */
import { config } from '../../config.js';
import { createObservabilityLogger } from '../observability/logger.js';
import { SgnlHttp } from './sgnl-http.js';
import type {
  SgnlFolderNode,
  SgnlGuidDto,
  SgnlItem,
  SgnlProject,
  SgnlUploadTicket,
} from './sgnl-types.js';

/** Scopes чтения: проекты, дерево папок, содержимое папок */
export const SGNL_READ_SCOPES = [
  'project:list',
  'project:read',
  'docs:folder:read',
  'docs:folder:list',
  'docs:item:list',
] as const;

/** Scopes записи: создание папок и загрузка файлов (включает чтение) */
export const SGNL_WRITE_SCOPES = [
  ...SGNL_READ_SCOPES,
  'docs:folder:create',
  'docs:item:create',
  'docs:object:create',
  'docs:version:create',
] as const;

/** Максимальный размер страницы списков SIGNAL */
const PAGE_SIZE = 200;
/** Таймаут PUT байтов по signed URL (файлы до 100 МБ) */
const PUT_SIGNED_TIMEOUT_MS = 600_000;

export interface SgnlClientOptions {
  /** Origin API без пути, например https://api.sgnl.pro */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  /** Инжектируемый fetch для тестов; по умолчанию глобальный */
  fetchImpl?: typeof fetch;
  /** Минимальный интервал между запросами (мс); 0 — без ограничения (тесты) */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Параметры загрузки нового файла в папку */
export interface SgnlUploadInput {
  projectId: string;
  folderId: string;
  name: string;
  mimeType: string;
  body: Buffer;
}

/** Контракт клиента, нужный синхронизации (позволяет подменять в тестах) */
export interface SgnlApi {
  listProjects(): Promise<SgnlProject[]>;
  getFolderTree(projectId: string): Promise<SgnlFolderNode>;
  listFolderItems(folderId: string): Promise<SgnlItem[]>;
  createFolder(parentId: string, name: string): Promise<string>;
  /** Шаги 1–4: объект (тикет → PUT → commit) и версия. Возвращает id объекта и версии. */
  uploadVersion(input: SgnlUploadInput): Promise<{ objectId: string; versionId: string }>;
  /** Шаг 5: файл в папке с готовой версией. Возвращает id item. */
  createFileItem(folderId: string, name: string, versionId: string): Promise<string>;
}

export class SgnlClient implements SgnlApi {
  readonly baseUrl: string;
  private readonly http: SgnlHttp;

  constructor(options: SgnlClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.http = new SgnlHttp({
      baseUrl: this.baseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      timeoutMs: options.timeoutMs ?? config.sgnlTimeoutMs,
      fetchImpl: options.fetchImpl ?? fetch,
      logger: createObservabilityLogger('sgnl'),
      minIntervalMs: options.minIntervalMs,
      sleep: options.sleep,
      now: options.now,
    });
  }

  /** Проверка подключения: токен на scopes чтения (без обращения к данным) */
  async ping(): Promise<{ ok: true; latencyMs: number }> {
    const startedAt = Date.now();
    await this.http.getToken(SGNL_READ_SCOPES);
    return { ok: true, latencyMs: Date.now() - startedAt };
  }

  /** Проверка выдачи scopes записи (для статуса в админке) */
  async checkWriteAccess(): Promise<void> {
    await this.http.getToken(SGNL_WRITE_SCOPES);
  }

  async listProjects(): Promise<SgnlProject[]> {
    const result: SgnlProject[] = [];
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await this.http.request<SgnlProject[]>('GET', '/public/v1/projects', {
        query: { Take: PAGE_SIZE, Skip: skip },
        scopes: SGNL_READ_SCOPES,
      });
      result.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) return result;
    }
  }

  async getFolderTree(projectId: string): Promise<SgnlFolderNode> {
    return this.http.request<SgnlFolderNode>(
      'GET',
      `/public/v1/projects/${encodeURIComponent(projectId)}/folders/tree`,
      { scopes: SGNL_READ_SCOPES },
    );
  }

  /** Непосредственное содержимое папки (без удалённых) */
  async listFolderItems(folderId: string): Promise<SgnlItem[]> {
    const result: SgnlItem[] = [];
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = await this.http.request<SgnlItem[]>('GET', '/public/v1/items', {
        query: { folderId, deleted: false, Take: PAGE_SIZE, Skip: skip },
        scopes: SGNL_READ_SCOPES,
      });
      result.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) return result;
    }
  }

  async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.http.request<SgnlGuidDto>('PUT', '/public/v1/folders', {
      body: { parentId, name },
      scopes: SGNL_WRITE_SCOPES,
    });
    return requireGuid(res, 'PUT /public/v1/folders');
  }

  async uploadVersion(input: SgnlUploadInput): Promise<{ objectId: string; versionId: string }> {
    // 1. Тикет объекта; повтор при 5xx безопасен — неподтверждённый объект не используется
    const ticket = await this.http.request<SgnlUploadTicket>('PUT', '/public/v1/objects', {
      body: { projectId: input.projectId, mimeType: input.mimeType, size: input.body.length },
      scopes: SGNL_WRITE_SCOPES,
      retryOnServerError: true,
    });
    if (!ticket?.objectId || !ticket.signedUrl) {
      throw new Error('SIGNAL: неожиданный ответ PUT /public/v1/objects');
    }
    // 2. Байты по signed URL
    await this.http.putSigned(ticket.signedUrl, input.body, input.mimeType, PUT_SIGNED_TIMEOUT_MS);
    // 3. Подтверждение загрузки объекта
    await this.http.request<unknown>(
      'POST',
      `/public/v1/objects/${encodeURIComponent(ticket.objectId)}/uploading/commit`,
      { scopes: SGNL_WRITE_SCOPES, retryOnServerError: true },
    );
    // 4. Версия объекта
    const version = await this.http.request<SgnlGuidDto>('POST', '/public/v1/versions', {
      body: { objectId: ticket.objectId, projectId: input.projectId, name: input.name },
      scopes: SGNL_WRITE_SCOPES,
    });
    return {
      objectId: ticket.objectId,
      versionId: requireGuid(version, 'POST /public/v1/versions'),
    };
  }

  async createFileItem(folderId: string, name: string, versionId: string): Promise<string> {
    const res = await this.http.request<SgnlGuidDto>('PUT', '/public/v1/items/file', {
      body: { name, folderId, versionId },
      scopes: SGNL_WRITE_SCOPES,
    });
    return requireGuid(res, 'PUT /public/v1/items/file');
  }
}

function requireGuid(res: SgnlGuidDto | undefined, endpoint: string): string {
  if (!res || typeof res.data !== 'string' || res.data.length === 0) {
    throw new Error(`SIGNAL: неожиданный ответ ${endpoint}`);
  }
  return res.data;
}

/** Нормализация baseUrl: валидный http(s)-origin без трейлинг-слэша и пути */
export function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`SGNL_BASE_URL не является корректным URL: "${raw}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SGNL_BASE_URL должен использовать http/https: "${raw}"`);
  }
  if (parsed.pathname.replace(/\/+$/, '') !== '') {
    throw new Error(`SGNL_BASE_URL должен быть origin без пути: "${raw}"`);
  }
  return parsed.origin;
}

export function createSgnlClient(options: SgnlClientOptions): SgnlClient {
  return new SgnlClient(options);
}

/** Фабрика из env. null — интеграция не настроена (валидное состояние). */
export function createSgnlClientFromEnv(): SgnlClient | null {
  if (!config.sgnlClientId || !config.sgnlClientSecret) return null;
  return createSgnlClient({
    baseUrl: config.sgnlBaseUrl,
    clientId: config.sgnlClientId,
    clientSecret: config.sgnlClientSecret,
    timeoutMs: config.sgnlTimeoutMs,
  });
}
