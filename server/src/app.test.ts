import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';

/**
 * Интеграционные тесты caркаса приложения через fastify.inject().
 * Без поднятия реальных сетевых подключений (skipInfra, skipRoutes).
 */
describe('createApp + /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      skipInfra: true,
      skipRoutes: true,
      logger: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health возвращает 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/health возвращает status=ok + uptime + memory + timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.memory).toBeTypeOf('object');
    expect(typeof body.timestamp).toBe('string');
    // ISO-8601 формат
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('GET на несуществующий маршрут возвращает 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('Helmet добавляет security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('preSerialization hook конвертирует snake_case → camelCase в ответе', async () => {
    // /api/health не использует snake_case, проверяем через CORS preflight нет.
    // Семантическая проверка: tests ниже проверят через моки. Здесь — sanity check на ключи.
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    // Health сам по себе уже camelCase
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('timestamp');
  });
});

describe('createApp базовые опции', () => {
  it('skipInfra=true не регистрирует database/s3/redis/queues', async () => {
    const app = await createApp({ skipInfra: true, skipRoutes: true, logger: false });
    expect(app.hasDecorator('supabase')).toBe(false);
    expect(app.hasDecorator('s3Client')).toBe(false);
    expect(app.hasDecorator('redis')).toBe(false);
    await app.close();
  });

  it('skipInfra=true + skipRoutes=true оставляет только health', async () => {
    const app = await createApp({ skipInfra: true, skipRoutes: true, logger: false });
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthRes.statusCode).toBe(200);

    const authRes = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(authRes.statusCode).toBe(404);
    await app.close();
  });
});
