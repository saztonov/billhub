/** Unit-тесты клиента исходящих событий EstiMat (инъекция fetch, без сети). */
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createEstimatClient } from './estimat-client.js';
import { EstimatApiError } from './estimat-errors.js';
import type { EstimatEvent } from './estimat-types.js';

const silent = pino({ level: 'silent' });

function sampleEvent(): EstimatEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    type: 'payment_request.workflow_changed',
    externalRef: 'estimat:pr:abc',
    bhRequestId: 'bh-1',
    aggregateVersion: 3,
    snapshot: { statusCode: 'approv_omts' },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createEstimatClient.sendEvent', () => {
  it('отправляет событие с Api-Key на /api/integration/events и возвращает статус', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { status: 'applied' } }));
    const client = createEstimatClient({
      baseUrl: 'https://estimat.example',
      token: 'secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silent,
    });

    const res = await client.sendEvent(sampleEvent());
    expect(res.status).toBe('applied');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://estimat.example/api/integration/events');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Api-Key secret-token');
  });

  it('401 → EstimatApiError api_key_invalid (не повторяется)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Не авторизован' }, 401));
    const client = createEstimatClient({
      baseUrl: 'https://estimat.example',
      token: 'bad',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silent,
    });

    await expect(client.sendEvent(sampleEvent())).rejects.toMatchObject({
      name: 'EstimatApiError',
      status: 401,
      code: 'api_key_invalid',
    } satisfies Partial<EstimatApiError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('409 с иным телом → conflict (не retry-later)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Конфликт: событие с тем же id и другим телом' }, 409),
    );
    const client = createEstimatClient({
      baseUrl: 'https://estimat.example',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silent,
    });

    await expect(client.sendEvent(sampleEvent())).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
