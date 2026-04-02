import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../types/index.js';

/**
 * Фабрика хука проверки роли — возвращает preHandler,
 * который пропускает только пользователей с указанными ролями
 */
export function requireRole(...roles: UserRole[]) {
  return async function checkRole(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const user = request.user;

    if (!user || !roles.includes(user.role)) {
      reply.status(403).send({ error: 'Доступ запрещён' });
      return;
    }
  };
}
