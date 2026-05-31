/**
 * Точечные rate-limit'ы для чувствительных auth-эндпоинтов (план Iteration 6).
 *
 * Глобальный @fastify/rate-limit (500/мин по IP) остаётся как есть. Здесь — отдельный
 * fixed-window limiter, который ключуется по (IP + email_hmac). Он реализован preHandler-ом
 * (а не через @fastify/rate-limit keyGenerator), потому что ключ зависит от тела запроса
 * (email), которое доступно только ПОСЛЕ парсинга/валидации — то есть на стадии preHandler,
 * а не onRequest, где работает глобальный лимитер.
 *
 * email псевдонимизируется HMAC-SHA256 (AUDIT_HMAC_KEY) — сырой email в ключи/логи не попадает.
 */
import { createHmac } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** HMAC-SHA256 нормализованного email (псевдоним для ключей rate-limit и audit_log). */
export function emailHmac(email: string, key: string): string {
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
}

interface Bucket {
  count: number;
  resetAtMs: number;
}

export interface RateLimitOptions {
  /** Максимум запросов в окне. */
  max: number;
  /** Размер окна (мс). */
  windowMs: string | number;
  /** Построение ключа из запроса (например, ip + email_hmac). */
  key: (request: FastifyRequest) => string;
  /** Источник времени (мс), инъекция для тестов. */
  now?: () => number;
}

function toMs(window: string | number): number {
  if (typeof window === 'number') return window;
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(window.trim());
  if (!m) return Number.parseInt(window, 10) || 0;
  const n = Number.parseInt(m[1]!, 10);
  switch (m[2]) {
    case 'h':
      return n * 3_600_000;
    case 'm':
      return n * 60_000;
    case 's':
      return n * 1000;
    default:
      return n;
  }
}

/**
 * Создаёт preHandler fixed-window rate-limit. При превышении — 429 + Retry-After.
 * Каждый экземпляр держит собственную in-memory карту окон.
 */
export function createRateLimiter(opts: RateLimitOptions) {
  const windowMs = toMs(opts.windowMs);
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const k = opts.key(request);
    const t = now();
    let b = buckets.get(k);
    if (!b || b.resetAtMs <= t) {
      b = { count: 0, resetAtMs: t + windowMs };
      buckets.set(k, b);
    }
    b.count += 1;
    if (b.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.resetAtMs - t) / 1000));
      reply.header('retry-after', String(retryAfterSec));
      reply.status(429).send({ error: 'Слишком много попыток. Повторите позже.' });
    }
  };
}

/** Тело логина/сброса с опциональным email — для построения ключа лимита. */
interface EmailBody {
  email?: unknown;
}

/** Ключ «IP + email_hmac» из тела запроса. */
export function ipEmailKey(hmacKey: string) {
  return (request: FastifyRequest): string => {
    const body = (request.body ?? {}) as EmailBody;
    const email = typeof body.email === 'string' ? body.email : '';
    return `${request.ip}|${email ? emailHmac(email, hmacKey) : 'no-email'}`;
  };
}
