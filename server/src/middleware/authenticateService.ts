import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Сервисная аутентификация ВХОДЯЩИХ M2M-запросов внешних систем (EstiMat → BillHub,
 * /api/external/v1). Заголовок: `Authorization: Api-Key <token>`, сравнение constant-time.
 *
 * Изоляция от пользовательских сессий: НЕ использует cookie/JWT, не заполняет request.user.
 * Пустой ожидаемый токен = интеграция выключена → всегда 401 (входящий API недоступен, пока
 * администратор не задаст секрет). Секрет уже редактится в pino-логах (authorization).
 *
 * Фабрика принимает геттер ожидаемого токена — для разных провайдеров/направлений можно
 * подключать разные секреты. Значение читается на каждый запрос (поддержка ротации без рестарта).
 */
function safeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function authenticateService(getExpectedToken: () => string) {
  return async function verifyApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const expected = getExpectedToken();
    if (!expected) {
      reply
        .status(401)
        .send({
          error: { code: 'external_api_not_configured', message: 'Интеграция не настроена' },
        });
      return;
    }
    const header = request.headers['authorization'];
    const prefix = 'Api-Key ';
    if (!header || !header.startsWith(prefix)) {
      reply.status(401).send({ error: { code: 'api_key_required', message: 'Не авторизован' } });
      return;
    }
    const provided = header.slice(prefix.length).trim();
    if (!provided || !safeEquals(provided, expected)) {
      reply.status(401).send({ error: { code: 'api_key_invalid', message: 'Не авторизован' } });
      return;
    }
  };
}

/** Готовый хук для входящего канала EstiMat (токен из ESTIMAT_INBOUND_TOKEN). */
export const authenticateEstimatService = authenticateService(() => config.estimatInboundToken);
