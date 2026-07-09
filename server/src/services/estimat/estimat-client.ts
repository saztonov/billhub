/**
 * Типизированный клиент исходящего канала событий BillHub → EstiMat.
 * Единственная операция — доставка события заявки на оплату (POST /api/integration/events).
 * Идемпотентность — по eventId; порядок применения на приёмнике — по aggregateVersion.
 *
 * createEstimatClientFromEnv() → null, если интеграция не настроена (ESTIMAT_BASE_URL /
 * ESTIMAT_INTEGRATION_TOKEN не заданы) ИЛИ выключен рубильник ESTIMAT_SYNC_ENABLED.
 * null — валидное состояние: события копятся в integration_outbox со статусом waiting_config.
 */
import pino, { type Logger } from 'pino';
import { config } from '../../config.js';
import { EstimatHttp } from './estimat-http.js';
import type { EstimatEvent, EstimatEventResult } from './estimat-types.js';

const EVENTS_PATH = '/api/integration/events';

export interface EstimatClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export interface EstimatClient {
  readonly baseUrl: string;
  /** Доставить событие заявки на оплату в EstiMat. */
  sendEvent(event: EstimatEvent): Promise<{ status: EstimatEventResult }>;
}

/** Валидация базового адреса EstiMat: только http(s), без кредов, https в проде. */
export function normalizeEstimatBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.username || url.password) throw new Error('ESTIMAT_BASE_URL не должен содержать креды');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ESTIMAT_BASE_URL: только http(s)');
  }
  if (url.protocol === 'http:' && config.nodeEnv === 'production') {
    throw new Error('ESTIMAT_BASE_URL: в проде требуется https');
  }
  return url.origin;
}

export function createEstimatClient(opts: EstimatClientOptions): EstimatClient {
  const baseUrl = normalizeEstimatBaseUrl(opts.baseUrl);
  const http = new EstimatHttp({
    baseUrl,
    token: opts.token,
    timeoutMs: opts.timeoutMs ?? config.estimatTimeoutMs,
    fetchImpl: opts.fetchImpl ?? fetch,
    logger: opts.logger ?? pino({ name: 'estimat' }),
  });

  return {
    baseUrl,
    async sendEvent(event: EstimatEvent): Promise<{ status: EstimatEventResult }> {
      // Ответ EstiMat: { data: { status: 'applied' | 'ignored_stale' | 'duplicate' } }.
      const res = await http.post<{ data?: { status?: EstimatEventResult } }>(EVENTS_PATH, event);
      return { status: res?.data?.status ?? 'applied' };
    },
  };
}

/** Фабрика из env. null — интеграция не настроена или выключен рубильник отправки. */
export function createEstimatClientFromEnv(logger?: Logger): EstimatClient | null {
  if (!config.estimatSyncEnabled) return null;
  if (!config.estimatBaseUrl || !config.estimatIntegrationToken) return null;
  return createEstimatClient({
    baseUrl: config.estimatBaseUrl,
    token: config.estimatIntegrationToken,
    logger,
  });
}
