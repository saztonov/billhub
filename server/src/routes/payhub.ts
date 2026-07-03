import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { PayHubApiError } from '../services/payhub/payhub-errors.js';

/**
 * Маршруты интеграции PayHub.
 *
 * GET /api/payhub/status — проверка подключения ТОЛЬКО для UI админки.
 * НЕ включается в /health и readiness-проверки: недоступность PayHub
 * не должна влиять на живость BillHub.
 */

/** Ответ проверки подключения (всегда HTTP 200 — фронт различает состояния по полям) */
interface PayHubStatusResponse {
  /** Заданы ли PAYHUB_BASE_URL/PAYHUB_API_TOKEN */
  configured: boolean;
  /** Успешен ли пробный вызов PayHub */
  ok: boolean;
  baseUrl?: string;
  latencyMs?: number;
  error?: {
    /** Код PayHub (api_key_invalid, insufficient_scope, ...) или network_error */
    code: string;
    httpStatus?: number;
    message: string;
  };
}

async function payhubRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- GET /api/payhub/status ---------- */
  fastify.get('/api/payhub/status', adminOnly, async (request, reply) => {
    const client = fastify.payhub;
    if (!client) {
      const body: PayHubStatusResponse = { configured: false, ok: false };
      return reply.send(body);
    }

    try {
      const ping = await client.ping();
      const body: PayHubStatusResponse = {
        configured: true,
        ok: true,
        baseUrl: client.baseUrl,
        latencyMs: ping.latencyMs,
      };
      return reply.send(body);
    } catch (error) {
      request.log.warn({ err: error }, 'PayHub: проверка подключения не прошла');
      const body: PayHubStatusResponse = {
        configured: true,
        ok: false,
        baseUrl: client.baseUrl,
        error:
          error instanceof PayHubApiError
            ? { code: error.code, httpStatus: error.status, message: error.message }
            : {
                code: 'network_error',
                message: error instanceof Error ? error.message : 'Сетевая ошибка',
              },
      };
      return reply.send(body);
    }
  });
}

export default payhubRoutes;
