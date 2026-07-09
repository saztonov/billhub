/** Unit-тесты клиента тендерного портала (инъекция fetch, без сети). */
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createTenderClient } from './tender-client.js';

const silent = pino({ level: 'silent' });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return createTenderClient({
    baseUrl: 'https://tender.example',
    token: 'tender-token',
    fetchImpl,
    logger: silent,
  });
}

describe('createTenderClient', () => {
  it('createTender шлёт POST /api/external/v1/tenders с Bearer и externalRef', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 't-1', status: 'draft' }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const tender = await client.createTender({
      title: 'Лот 1',
      external_ref: 'billhub:tender:lot-1',
      items: [{ material: 'Кабель', quantity: 100, unit: 'м' }],
    });
    expect(tender.id).toBe('t-1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://tender.example/api/external/v1/tenders');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tender-token');
  });

  it('getTenderResults возвращает участников и предложения', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        tender_id: 't-1',
        status: 'finished',
        participants: [{ id: 'p1', name: 'Поставщик 1' }],
        bids: [{ participant_id: 'p1', amount: 12345 }],
        winner: { participant_id: 'p1' },
      }),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const res = await client.getTenderResults('t-1');
    expect(res.status).toBe('finished');
    expect(res.bids[0]!.amount).toBe(12345);
    expect(res.winner?.participant_id).toBe('p1');
  });

  it('400 → TenderApiError с кодом из тела (мутация не повторяется)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'validation_error', message: 'bad' } }, 400),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(
      client.createTender({ title: 'x', external_ref: 'r', items: [] }),
    ).rejects.toMatchObject({ name: 'TenderApiError', status: 400, code: 'validation_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ping: true при доступности, false при ошибке', async () => {
    const ok = makeClient((async () => jsonResponse({ ok: true })) as unknown as typeof fetch);
    expect(await ok.ping()).toBe(true);
    const bad = makeClient((async () => jsonResponse({}, 500)) as unknown as typeof fetch);
    expect(await bad.ping()).toBe(false);
  });
});
