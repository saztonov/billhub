/**
 * Типизированный клиент тендерного портала. BillHub — инициатор: создаёт тендер (идемпотентно
 * по externalRef), опрашивает результаты (участники/предложения/победитель) до статуса finished.
 *
 * createTenderClientFromEnv() → null, если TENDER_BASE_URL/TENDER_API_TOKEN не заданы
 * (валидное состояние: тендер-действия копятся/ждут настройки).
 */
import pino, { type Logger } from 'pino';
import { config } from '../../config.js';
import { TenderHttp } from './tender-http.js';
import type { CreateTenderInput, Tender, TenderResults } from './tender-types.js';

export interface TenderClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export interface TenderClient {
  readonly baseUrl: string;
  createTender(input: CreateTenderInput): Promise<Tender>;
  getTender(id: string): Promise<Tender>;
  getTenderResults(id: string): Promise<TenderResults>;
  cancelTender(id: string): Promise<void>;
  /** Дешёвая проверка доступности (для админ-статуса). */
  ping(): Promise<boolean>;
}

export function normalizeTenderBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.username || url.password) throw new Error('TENDER_BASE_URL не должен содержать креды');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('TENDER_BASE_URL: только http(s)');
  }
  if (url.protocol === 'http:' && config.nodeEnv === 'production') {
    throw new Error('TENDER_BASE_URL: в проде требуется https');
  }
  return url.origin;
}

export function createTenderClient(opts: TenderClientOptions): TenderClient {
  const baseUrl = normalizeTenderBaseUrl(opts.baseUrl);
  const http = new TenderHttp({
    baseUrl,
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? config.tenderTimeoutMs,
    fetchImpl: opts.fetchImpl ?? fetch,
    logger: opts.logger ?? pino({ name: 'tender' }),
  });

  return {
    baseUrl,
    createTender: (input) => http.request<Tender>('POST', '/tenders', { body: input }),
    getTender: (id) => http.request<Tender>('GET', `/tenders/${encodeURIComponent(id)}`),
    getTenderResults: (id) =>
      http.request<TenderResults>('GET', `/tenders/${encodeURIComponent(id)}/results`),
    async cancelTender(id) {
      await http.request<void>('POST', `/tenders/${encodeURIComponent(id)}/cancel`);
    },
    async ping() {
      try {
        // Дешёвый read-only вызов без ретраев и с коротким таймаутом.
        await http.request('GET', '/health', { retries: 0, timeoutMs: 3000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Фабрика из env. null — интеграция тендера не настроена. */
export function createTenderClientFromEnv(logger?: Logger): TenderClient | null {
  if (!config.tenderBaseUrl || !config.tenderApiToken) return null;
  return createTenderClient({
    baseUrl: config.tenderBaseUrl,
    token: config.tenderApiToken,
    logger,
  });
}
