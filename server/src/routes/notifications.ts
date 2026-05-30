import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов уведомлений (через fastify.repos)                 */
/* ------------------------------------------------------------------ */

async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  /* ---------- GET /api/notifications ---------- */
  fastify.get('/api/notifications', auth, async (request) => {
    return request.server.repos.notifications.listUnread(request.user!.id);
  });

  /* ---------- GET /api/notifications/count ---------- */
  fastify.get('/api/notifications/count', auth, async (request) => {
    const count = await request.server.repos.notifications.countUnread(request.user!.id);
    return { count };
  });

  /* ---------- POST /api/notifications/:id/mark-read ---------- */
  fastify.post('/api/notifications/:id/mark-read', auth, async (request) => {
    const { id } = request.params as { id: string };
    await request.server.repos.notifications.markRead(id);
    return { success: true };
  });

  /* ---------- POST /api/notifications/mark-all-read ---------- */
  fastify.post('/api/notifications/mark-all-read', auth, async (request) => {
    await request.server.repos.notifications.markAllRead(request.user!.id);
    return { success: true };
  });
}

export default notificationRoutes;
