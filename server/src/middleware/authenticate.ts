import { jwtVerify, createRemoteJWKSet } from 'jose';
import { LRUCache } from 'lru-cache';
import { config } from '../config.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestUser, UserRole } from '../types/index.js';

/** Кеш профилей пользователей (TTL 15 сек, макс. 500 записей) */
const userCache = new LRUCache<string, RequestUser>({
  max: 500,
  ttl: 15_000,
});

/** JWKS для верификации JWT (поддерживает ES256 и HS256) */
const JWKS = createRemoteJWKSet(
  new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`)
);

/**
 * Хук аутентификации — проверяет JWT из куки access_token,
 * загружает профиль пользователя и прикрепляет к запросу
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = request.cookies['access_token'];

  if (!token) {
    reply.status(401).send({ error: 'Не авторизован' });
    return;
  }

  let userId: string;

  try {
    const { payload } = await jwtVerify(token, JWKS);
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
    .select(
      'id, email, role, counterparty_id, department_id, all_sites, full_name, is_active'
    )
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
