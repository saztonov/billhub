import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import { LRUCache } from 'lru-cache';
import { config } from '../config.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestUser, UserRole } from '../types/index.js';
import type { UserAuthRecord } from '../services/auth/stores/types.js';
import { resolveKeycloakIdentity } from '../services/auth/keycloak/identity-resolve.js';

/** Кеш профилей пользователей (TTL 15 сек, макс. 500 записей) */
const userCache = new LRUCache<string, RequestUser>({
  max: 500,
  ttl: 15_000,
});

/**
 * JWKS для верификации JWT Supabase (режим supabase-bridge). Инициализируется лениво:
 * в standalone URL не строится, поэтому пустой SUPABASE_URL не роняет импорт модуля.
 */
let supabaseJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getSupabaseJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!supabaseJwks) {
    supabaseJwks = createRemoteJWKSet(
      new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
  }
  return supabaseJwks;
}

/** JWKS Keycloak (режим keycloak). Лениво: в других режимах URL не строится. */
let keycloakJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getKeycloakJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!keycloakJwks) {
    keycloakJwks = createRemoteJWKSet(
      new URL(`${config.oidcIssuer}/protocol/openid-connect/certs`),
    );
  }
  return keycloakJwks;
}

/** Членство в группе портала: совпадение по имени или полному пути `/<name>`. */
function hasPortalGroup(groups: unknown, name: string): boolean {
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => typeof g === 'string' && (g === name || g.endsWith(`/${name}`)));
}

/** UserAuthRecord (standalone-хранилище) → RequestUser. */
function recordToRequestUser(rec: UserAuthRecord): RequestUser {
  return {
    id: rec.id,
    email: rec.email,
    fullName: rec.fullName,
    role: rec.role as UserRole,
    counterpartyId: rec.counterpartyId ?? undefined,
    department: rec.departmentId ?? undefined,
    allSites: rec.allSites,
    isActive: rec.isActive,
  };
}

/**
 * Хук аутентификации — проверяет JWT из куки access_token, загружает профиль и
 * прикрепляет к запросу. Ветвится по AUTH_MODE:
 *   standalone      — верификация собственного access JWT (TokenService) + профиль из
 *                     authServices.users.
 *   supabase-bridge — верификация через JWKS Supabase + профиль из таблицы users (legacy).
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies['access_token'];

  if (!token) {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  const mode = request.server.authMode ?? 'supabase-bridge';

  if (mode === 'standalone') {
    await authenticateStandalone(request, reply, token);
    return;
  }

  if (mode === 'keycloak') {
    await authenticateKeycloak(request, reply, token);
    return;
  }

  await authenticateSupabaseBridge(request, reply, token);
}

/**
 * Keycloak: верификация access-токена по JWKS (iss/aud/azp/exp), гейт доступа по группе
 * портала (billhub-active) и резолв локального профиля через user_identity_links (роль из БД).
 */
async function authenticateKeycloak(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
): Promise<void> {
  let sub: string;
  let groups: unknown;
  let billhubUserId: string | null = null;
  try {
    const { payload } = await jwtVerify(token, getKeycloakJwks(), {
      issuer: config.oidcIssuer,
      audience: config.oidcClientId,
    });
    sub = payload.sub as string;
    // azp (authorized party) должен быть нашим клиентом.
    if (!sub || payload.azp !== config.oidcClientId) {
      reply.status(401).send({ error: 'Не авторизован' });
      return;
    }
    if (typeof payload.exp === 'number') request.accessTokenExp = payload.exp;
    groups = (payload as Record<string, unknown>).groups;
    const claim = (payload as Record<string, unknown>).billhub_user_id;
    billhubUserId = typeof claim === 'string' ? claim : null;
  } catch {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  // Гейт доступа к порталу — по группе Keycloak (из токена, каждый запрос: деактивация в
  // Keycloak/BillHub вступает в силу на следующем токене).
  if (!hasPortalGroup(groups, config.kcPortalGroupActive)) {
    if (hasPortalGroup(groups, config.kcPortalGroupPending)) {
      reply
        .status(403)
        .send({ error: 'Доступ ожидает активации администратором', code: 'pending_activation' });
    } else {
      reply.status(403).send({ error: 'Нет доступа к порталу' });
    }
    return;
  }

  // Резолв идентичности (Ф1): claim billhub_user_id → user_identity_links (provider-agnostic).
  // Кеш профиля — по users.id (стабилен между провайдерами, инвалидируется при смене профиля/активации);
  // гейт по группе выше — из токена каждый запрос (не кешируется).

  // Быстрый путь: claim = users.id → кеш по нему без обращения к БД.
  if (billhubUserId) {
    const cached = userCache.get(billhubUserId);
    if (cached) {
      request.user = cached;
      return;
    }
  }

  const resolved = await resolveKeycloakIdentity(
    {
      users: request.server.authServices.users,
      links: request.server.authServices.identityLinks,
    },
    { billhubUserId, sub },
  );
  if (!resolved) {
    // Активная группа, но нет связи/строки в BillHub — профиль ещё не заведён (нужен онбординг).
    reply.status(403).send({ error: 'Профиль не заведён в портале' });
    return;
  }

  const user = recordToRequestUser(resolved.rec);
  userCache.set(resolved.rec.id, user);
  request.user = user;

  // last_seen_at обновляем на cache-miss через реальный provider из link (throttle ~раз в TTL кеша).
  if (resolved.via === 'link' && resolved.provider) {
    void request.server.authServices.identityLinks
      .touchLastSeen(resolved.provider, sub, new Date().toISOString())
      .catch(() => {});
  }
}

/** Standalone: собственный access JWT + профиль из authServices.users. */
async function authenticateStandalone(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
): Promise<void> {
  let userId: string;
  try {
    const claims = await request.server.authServices.tokens.verifyAccess(token);
    userId = claims.sub;
    const decoded = decodeJwt(token);
    if (typeof decoded.exp === 'number') request.accessTokenExp = decoded.exp;
  } catch {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  const cached = userCache.get(userId);
  if (cached) {
    request.user = cached;
    return;
  }

  const rec = await request.server.authServices.users.findById(userId);
  if (!rec || !rec.isActive) {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  const user = recordToRequestUser(rec);
  userCache.set(userId, user);
  request.user = user;
}

/** Legacy: верификация JWT Supabase через JWKS + профиль из таблицы users. */
async function authenticateSupabaseBridge(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
): Promise<void> {
  let userId: string;

  try {
    const { payload } = await jwtVerify(token, getSupabaseJwks());
    userId = payload.sub as string;

    if (!userId) {
      reply.status(401).send({ error: 'Не авторизован' });
      return;
    }

    /** Сохраняем время истечения токена (секунды) — нужно для проактивного refresh */
    if (typeof payload.exp === 'number') {
      request.accessTokenExp = payload.exp;
    }
  } catch {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  /** Проверяем кеш */
  const cached = userCache.get(userId);
  if (cached) {
    request.user = cached;
    return;
  }

  /** Загружаем профиль из БД */
  const { data, error } = await request.server.supabase
    .from('users')
    .select('id, email, role, counterparty_id, department_id, all_sites, full_name, is_active')
    .eq('id', userId)
    .single();

  if (error || !data) {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  if (!data.is_active) {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  const user: RequestUser = {
    id: data.id as string,
    email: data.email as string,
    fullName: data.full_name as string,
    role: data.role as UserRole,
    counterpartyId: (data.counterparty_id as string) || undefined,
    department: (data.department_id as string) || undefined,
    allSites: data.all_sites as boolean,
    isActive: data.is_active as boolean,
  };

  userCache.set(userId, user);
  request.user = user;
}

/**
 * Инвалидация кеша профиля по users.id (Ф1). Вызывать при смене профиля/роли/активации/деактивации
 * (см. routes/users.ts), чтобы 15-сек кеш не отдавал устаревший профиль. Гейт по группе не кешируется.
 */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

/** Сброс кеша профилей (для тестов). */
export function _clearUserCache(): void {
  userCache.clear();
}
