import { afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { config } from '../config.js';
import authRoutes from './auth.js';

const savedMode = process.env.AUTH_MODE;
const savedIssuer = config.oidcIssuer;

async function getAuthConfig(mode: 'standalone' | 'supabase-bridge' | 'keycloak') {
  process.env.AUTH_MODE = mode;
  const app = Fastify({ logger: false });
  await app.register(authRoutes);
  await app.ready();
  try {
    return await app.inject({ method: 'GET', url: '/api/auth/config' });
  } finally {
    await app.close();
  }
}

afterAll(() => {
  if (savedMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = savedMode;
  config.oidcIssuer = savedIssuer;
});

describe('GET /api/auth/config', () => {
  it.each(['standalone', 'supabase-bridge'] as const)('?????????? 200 ? mode=%s', async (mode) => {
    const response = await getAuthConfig(mode);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode });
  });

  it('????????? loginUrl ? accountUrl ? keycloak-??????', async () => {
    config.oidcIssuer = 'https://auth.example.test/realms/billhub';
    const response = await getAuthConfig('keycloak');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'keycloak',
      loginUrl: '/api/auth/login',
      accountUrl: 'https://auth.example.test/realms/billhub/account',
    });
  });
});
