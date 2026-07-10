/**
 * Keycloak-маршруты аутентификации (AUTH_MODE=keycloak, OIDC Authorization Code + PKCE, BFF).
 * Регистрируются диспетчером routes/auth.ts. Браузер токены не видит — всё в httpOnly-cookie.
 *
 * Эндпоинты:
 *   GET  /api/auth/config          — публичный { mode, loginUrl, accountUrl } (rollback-safe фронт).
 *   GET  /api/auth/csrf            — выдать CSRF-токен (double-submit; cookie ставит csrf-плагин).
 *   GET  /api/auth/login           — старт PKCE-потока, редирект на Keycloak (top-level GET).
 *   GET  /api/auth/validate-token  — проверка registration_token контрагента (имя для UI).
 *   GET  /api/auth/oidc/callback   — обмен code, резолв/онбординг идентичности, cookie, редирект.
 *   POST /api/auth/refresh         — refresh-grant к Keycloak, ротация cookie.
 *   POST /api/auth/logout          — очистка cookie + { logoutUrl } (top-level end-session на фронте).
 *   GET  /api/auth/me              — текущий пользователь (через authenticate).
 *
 * Гейт доступа к порталу — по группе Keycloak (billhub-active) в middleware/authenticate.
 * Роль/контрагент — из БД BillHub (grant-only). BillHub НЕ создаёт Keycloak-пользователей.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { counterparties } from '../db/schema/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { keycloakAdminClient, KcUserExistsError } from '../services/auth/keycloak/admin-client.js';
import { provisionPortalUser } from '../services/auth/keycloak/provisioning.js';
import { resolveKeycloakIdentity } from '../services/auth/keycloak/identity-resolve.js';
import { MIN_PASSWORD_LENGTH, PasswordService } from '../services/auth/password.service.js';
import {
  oidcService,
  type OidcIdentity,
  type OidcTokens,
} from '../services/auth/keycloak/oidc.service.js';

const isProduction = config.nodeEnv === 'production';
const LOGIN_STATE_COOKIE = 'kc_login';
const REFRESH_COOKIE_PATH = '/api/auth';
const LEGACY_REFRESH_COOKIE_PATH = '/api/auth/refresh';

/* ------------------------------- Cookie-хелперы ---------------------------- */

function accessCookie(maxAgeSec: number): CookieSerializeOptions {
  return { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: maxAgeSec };
}

function refreshCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTtlSeconds,
  };
}

/** Короткоживущая cookie состояния входа (PKCE verifier/state/nonce/returnUrl/regToken). */
function loginStateCookie(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: 300,
  };
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
  reply.clearCookie('refresh_token', { path: LEGACY_REFRESH_COOKIE_PATH });
}

function setAuthCookies(reply: FastifyReply, tokens: OidcTokens): void {
  const maxAge = tokens.accessTokenExpiresAtMs
    ? Math.max(1, Math.floor((tokens.accessTokenExpiresAtMs - Date.now()) / 1000))
    : config.jwtAccessTtlSeconds;
  reply.setCookie('access_token', tokens.accessToken, accessCookie(maxAge));
  if (tokens.refreshToken) {
    reply.setCookie('refresh_token', tokens.refreshToken, refreshCookie());
  }
}

/* ------------------------------- Утилиты ----------------------------------- */

interface LoginState {
  v: string; // code_verifier
  s: string; // state
  n: string; // nonce
  r: string; // returnUrl (относительный)
}

function encodeState(o: LoginState): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}
function decodeState(s: string): LoginState {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as LoginState;
}

/** Только относительные пути (защита от open-redirect). */
function safeReturnUrl(raw?: string): string {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

/** Членство в группе портала по имени или полному пути `/<name>`. */
function hasPortalGroup(groups: unknown, name: string): boolean {
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => typeof g === 'string' && (g === name || g.endsWith(`/${name}`)));
}

/** Группы из access-токена Keycloak (без verify — токен только что получен по TLS). */
function tokenGroups(accessToken: string): unknown {
  try {
    return (decodeJwt(accessToken) as Record<string, unknown>).groups;
  } catch {
    return undefined;
  }
}

/** Тело public-регистрации подрядчика (Вариант B). */
const registerCounterpartySchema = z.object({
  token: z.string().min(1),
  email: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(1),
});

/* --------------------------------- Плагин ---------------------------------- */

async function keycloakAuthRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/auth/csrf — выдать CSRF-токен (double-submit). */
  fastify.get('/api/auth/csrf', async (request) => {
    return { csrfToken: request.csrfToken ?? null };
  });

  /** GET /api/auth/login — старт PKCE-потока (top-level GET-редирект на Keycloak). */
  fastify.get('/api/auth/login', async (request, reply) => {
    const q = request.query as { returnUrl?: string };
    const challenge = await oidcService.buildLoginChallenge();
    const state: LoginState = {
      v: challenge.codeVerifier,
      s: challenge.state,
      n: challenge.nonce,
      r: safeReturnUrl(q.returnUrl),
    };
    reply.setCookie(LOGIN_STATE_COOKIE, encodeState(state), loginStateCookie());
    return reply.redirect(challenge.authorizationUrl);
  });

  /** GET /api/auth/validate-token — проверка registration_token контрагента. */
  fastify.get('/api/auth/validate-token', async (request, reply) => {
    const q = request.query as { token?: string };
    if (!q.token) return reply.status(400).send({ error: 'Токен не указан' });
    const cp = await findCounterpartyByToken(request, q.token);
    if (!cp) return reply.status(404).send({ valid: false });
    return { valid: true, counterpartyName: cp.name };
  });

  /**
   * POST /api/auth/register-counterparty — регистрация подрядчика (Вариант B, IdP закрыт).
   * Валидирует counterparty-token + пароль → провижинит KC-идентичность через Admin API
   * (enabled, emailVerified, billhub_user_id, credentials) → billhub-pending → локальный users
   * (inactive) + link. Идемпотентность/анти-enumeration: одинаковый ответ для «создан» и «уже есть».
   * Компенсация: при сбое локальной записи удаляем KC-юзера. Активацию делает админ.
   */
  fastify.post(
    '/api/auth/register-counterparty',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      if (config.cutoverFreeze) {
        return reply
          .status(503)
          .send({ error: 'Регистрация временно приостановлена (окно миграции)' });
      }
      const parsed = registerCounterpartySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Неверный формат данных' });
      const { token, email, fullName, password } = parsed.data;

      if (!PasswordService.validateStrength(password)) {
        return reply
          .status(400)
          .send({ error: `Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов` });
      }

      const cp = await findCounterpartyByToken(request, token);
      if (!cp) return reply.status(400).send({ error: 'Регистрация недоступна по этой ссылке' });

      const users = request.server.authServices.users;
      const links = request.server.authServices.identityLinks;

      // Анти-enumeration: если email уже есть — тот же «submitted», что и при создании.
      if (await users.findByEmail(email)) return { status: 'submitted' as const };

      const userId = randomUUID();
      let sub: string;
      try {
        sub = await provisionPortalUser(keycloakAdminClient, { userId, email, fullName, password });
      } catch (err) {
        if (err instanceof KcUserExistsError) return { status: 'submitted' as const };
        request.log.error({ err }, 'register-counterparty: провижининг KC не удался');
        return reply.status(500).send({ error: 'Не удалось завершить регистрацию' });
      }

      try {
        await request.server.repos.users.createCounterpartyUserRecord({
          id: userId,
          email,
          fullName,
          counterpartyId: cp.id,
          isActive: false,
        });
        await links.link({
          userId,
          provider: config.authIdentityProvider,
          subject: sub,
          emailAtLink: email,
        });
      } catch (err) {
        request.log.error(
          { err },
          'register-counterparty: локальная запись не удалась, компенсация KC',
        );
        try {
          await keycloakAdminClient.deleteUser(sub);
        } catch (delErr) {
          request.log.error({ err: delErr }, 'register-counterparty: компенсация KC не удалась');
        }
        return reply.status(500).send({ error: 'Не удалось завершить регистрацию' });
      }

      return { status: 'submitted' as const };
    },
  );

  /** GET /api/auth/oidc/callback — обмен code, резолв/онбординг, cookie, редирект. */
  fastify.get('/api/auth/oidc/callback', async (request, reply) => {
    const raw = request.cookies[LOGIN_STATE_COOKIE];
    reply.clearCookie(LOGIN_STATE_COOKIE, { path: REFRESH_COOKIE_PATH });
    if (!raw) {
      return reply.status(400).send({ error: 'Сессия входа не найдена или истекла' });
    }
    let st: LoginState;
    try {
      st = decodeState(raw);
    } catch {
      return reply.status(400).send({ error: 'Некорректное состояние входа' });
    }

    const currentUrl = new URL(config.oidcRedirectUri);
    for (const [k, v] of Object.entries(request.query as Record<string, string>)) {
      currentUrl.searchParams.set(k, v);
    }

    let tokens: OidcTokens;
    let identity: OidcIdentity;
    try {
      const res = await oidcService.handleCallback(currentUrl, {
        codeVerifier: st.v,
        state: st.s,
        nonce: st.n,
      });
      tokens = res.tokens;
      identity = res.identity;
    } catch (err) {
      request.log.warn({ err }, 'oidc callback: обмен code не удался');
      return reply.status(401).send({ error: 'Не удалось завершить вход' });
    }

    const outcome = await resolveIdentity(request, identity, tokens.accessToken);
    if (outcome === 'no_access') {
      // Идентичность без заведённого доступа к порталу (регистрация — через register-counterparty).
      return reply.redirect('/login?error=no_access');
    }

    setAuthCookies(reply, tokens);
    return reply.redirect(outcome === 'pending' ? '/pending-activation' : st.r);
  });

  /** POST /api/auth/refresh — refresh-grant к Keycloak, ротация cookie. */
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const rt = request.cookies['refresh_token'];
    if (!rt) return reply.status(401).send({ error: 'Refresh token отсутствует' });
    let tokens: OidcTokens;
    try {
      tokens = await oidcService.refresh(rt);
    } catch {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Не удалось обновить сессию' });
    }
    setAuthCookies(reply, tokens);
    return { success: true, accessTokenExpiresAt: tokens.accessTokenExpiresAtMs };
  });

  /** POST /api/auth/logout — очистка cookie + end-session URL (навигация — на фронте). */
  fastify.post('/api/auth/logout', async (request, reply) => {
    clearAuthCookies(reply);
    let logoutUrl = config.oidcPostLogoutRedirectUri;
    try {
      logoutUrl = await oidcService.buildLogoutUrl(null);
    } catch (err) {
      request.log.warn({ err }, 'logout: не удалось построить end-session URL');
    }
    return { success: true, logoutUrl };
  });

  /** GET /api/auth/me — текущий пользователь. */
  fastify.get('/api/auth/me', { preHandler: [authenticate] }, async (request) => {
    const exp = request.accessTokenExp;
    const accessTokenExpiresAt =
      typeof exp === 'number' ? exp * 1000 : Date.now() + config.jwtAccessTtlSeconds * 1000;
    return { user: request.user, accessTokenExpiresAt };
  });
}

/* ----------------------------- Онбординг/резолв ---------------------------- */

async function findCounterpartyByToken(
  request: FastifyRequest,
  token: string,
): Promise<{ id: string; name: string } | null> {
  const db = request.server.db;
  if (!db) return null;
  const [r] = await db
    .select({ id: counterparties.id, name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.registrationToken, token))
    .limit(1);
  return r ?? null;
}

/**
 * Резолв идентичности Keycloak → доступ (Ф1, provider-agnostic). Порядок:
 *   1) claim billhub_user_id → users.findById;
 *   2) user_identity_links по (provider, subject) среди известных провайдеров;
 *   3) verified-email-fallback (аварийный: массово-перенесённый/admin-created без claim) — только для
 *      email_verified, с WARN.
 * Возвращает 'active'|'pending' (по группе billhub-active в токене) либо 'no_access'. Регистрация
 * подрядчика — ТОЛЬКО через POST /api/auth/register-counterparty (Вариант B), не здесь.
 */
async function resolveIdentity(
  request: FastifyRequest,
  identity: OidcIdentity,
  accessToken: string,
): Promise<'active' | 'pending' | 'no_access'> {
  const provider = config.authIdentityProvider;
  const { sub, email, billhubUserId, emailVerified } = identity;
  const links = request.server.authServices.identityLinks;
  const users = request.server.authServices.users;

  const isActiveNow = (): boolean =>
    hasPortalGroup(tokenGroups(accessToken), config.kcPortalGroupActive);

  // 1-2: резолв по claim / links (provider-agnostic).
  const resolved = await resolveKeycloakIdentity({ users, links }, { billhubUserId, sub });
  if (resolved) {
    // Идемпотентно поддерживаем link для текущего (provider, sub): нужен для sync групп/reconcile и
    // перелинка на новый provider (AD) по billhub_user_id.
    await links.link({ userId: resolved.rec.id, provider, subject: sub, emailAtLink: email });
    return isActiveNow() ? 'active' : 'pending';
  }

  // 3: verified-email-fallback (аварийный/диагностический путь).
  if (email && emailVerified) {
    const emailRec = await users.findByEmail(email);
    if (emailRec) {
      request.log.warn(
        { userId: emailRec.id, provider },
        'keycloak resolve: email-fallback (link отсутствовал) — проверьте маппер billhub_user_id',
      );
      await links.link({ userId: emailRec.id, provider, subject: sub, emailAtLink: email });
      await ensurePortalGroup(request, sub, accessToken);
      return isActiveNow() ? 'active' : 'pending';
    }
  }

  return 'no_access';
}

/** Если пользователь не состоит ни в одной группе портала — добавить в billhub-pending. */
async function ensurePortalGroup(
  request: FastifyRequest,
  sub: string,
  accessToken: string,
): Promise<void> {
  const groups = tokenGroups(accessToken);
  if (
    hasPortalGroup(groups, config.kcPortalGroupActive) ||
    hasPortalGroup(groups, config.kcPortalGroupPending)
  ) {
    return;
  }
  try {
    await keycloakAdminClient.addPortalPending(sub);
  } catch (err) {
    request.log.error({ err }, 'ensurePortalGroup: не удалось добавить в billhub-pending');
  }
}

export default keycloakAuthRoutes;
