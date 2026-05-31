import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createErrorLogBodySchema, bulkDeleteErrorLogBodySchema } from '../schemas/error-log.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов логов ошибок (через fastify.repos.errorLogs)      */
/* ------------------------------------------------------------------ */

async function errorLogRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };
  const auth = { preHandler: [authenticate] };

  /* ---------- GET /api/error-logs ---------- */
  fastify.get('/api/error-logs', adminOnly, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return request.server.repos.errorLogs.list({
      page: parseInt(query.page ?? '1', 10),
      pageSize: parseInt(query.pageSize ?? '20', 10),
      errorTypes: query.errorTypes ? query.errorTypes.split(',') : undefined,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  });

  /* ---------- POST /api/error-logs ---------- */
  fastify.post('/api/error-logs', auth, async (request, reply) => {
    const user = request.user!;
    const body = createErrorLogBodySchema.parse(request.body);
    await request.server.repos.errorLogs.create({ ...body, userId: user.id });
    return reply.status(201).send({ success: true });
  });

  /* ---------- DELETE /api/error-logs/bulk ---------- */
  fastify.delete('/api/error-logs/bulk', adminOnly, async (request) => {
    const body = bulkDeleteErrorLogBodySchema.parse(request.body);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - body.olderThanDays);
    await request.server.repos.errorLogs.deleteOlderThan(cutoffDate.toISOString());
    return { success: true };
  });
}

export default errorLogRoutes;
