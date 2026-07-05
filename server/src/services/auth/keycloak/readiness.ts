/**
 * Ф4 — readiness-проба Keycloak: доступность OIDC discovery и JWKS. Используется в startup-checks
 * (fail-fast при старте в проде) и в /api/health/ready. Только в keycloak-режиме; в других — no-op.
 *
 * Лёгкая: два HTTP GET с таймаутом, без openid-client (не тянет discovery-кеш сервиса). Секреты не
 * передаются (публичные endpoints realm).
 */
import { config } from '../../../config.js';

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Проверяет discovery (`.well-known/openid-configuration`) и JWKS (`jwks_uri`). Бросает при
 * недоступности/пустом наборе ключей. `timeoutMs` — на каждый запрос.
 */
export async function assertKeycloakReady(timeoutMs = 3000): Promise<void> {
  const issuer = config.oidcIssuer.replace(/\/+$/, '');
  const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`, timeoutMs);
  const jwksUri =
    typeof discovery.jwks_uri === 'string'
      ? discovery.jwks_uri
      : `${issuer}/protocol/openid-connect/certs`;
  const jwks = await fetchJson(jwksUri, timeoutMs);
  const keys = jwks.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('JWKS не содержит ключей');
  }
}
