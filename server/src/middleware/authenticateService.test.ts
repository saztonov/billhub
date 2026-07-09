/** Unit-тесты сервисной Api-Key аутентификации входящих M2M-запросов. */
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticateService } from './authenticateService.js';

function mockReply() {
  const reply = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return reply;
}

function req(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as unknown as FastifyRequest;
}

describe('authenticateService', () => {
  it('пустой ожидаемый токен → 401 external_api_not_configured', async () => {
    const hook = authenticateService(() => '');
    const reply = mockReply();
    await hook(req('Api-Key whatever'), reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: { code: string } }).error.code).toBe(
      'external_api_not_configured',
    );
  });

  it('нет заголовка → 401 api_key_required', async () => {
    const hook = authenticateService(() => 'secret');
    const reply = mockReply();
    await hook(req(), reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: { code: string } }).error.code).toBe('api_key_required');
  });

  it('неверный токен → 401 api_key_invalid', async () => {
    const hook = authenticateService(() => 'secret');
    const reply = mockReply();
    await hook(req('Api-Key wrong'), reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: { code: string } }).error.code).toBe('api_key_invalid');
  });

  it('верный токен → пропускает (reply не вызван)', async () => {
    const hook = authenticateService(() => 'secret');
    const reply = mockReply();
    const sendSpy = vi.spyOn(reply, 'send');
    await hook(req('Api-Key secret'), reply as unknown as FastifyReply);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(0);
  });
});
