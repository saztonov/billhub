import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { DrizzleRpRepository } from '../repositories/drizzle/rp.drizzle.js';
import {
  createRpBodySchema,
  updateRpStatusBodySchema,
  rpDocumentsQuerySchema,
} from '../schemas/rp.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов реестра РП. Только Drizzle (без Supabase).        */
/* ------------------------------------------------------------------ */

async function rpRoutes(fastify: FastifyInstance): Promise<void> {
  let repoCache: DrizzleRpRepository | null = null;
  /** Ленивая инициализация: реестр РП реализован только на Drizzle (без Supabase). */
  function getRepo(): DrizzleRpRepository {
    if (repoCache) return repoCache;
    const db = fastify.db;
    if (!db) {
      throw new Error(
        'РП-роуты требуют DB_PROVIDER=drizzle (fastify.db не инициализирован). ' +
          'Реестр РП реализован только на Drizzle.',
      );
    }
    repoCache = new DrizzleRpRepository(db);
    return repoCache;
  }

  const adminOrUser = { preHandler: [authenticate, requireRole('admin', 'user')] };

  /** Вычисляет ограничение по объектам для обычного user (null => все объекты). */
  async function resolveSiteScope(userId: string, role: string, allSites: boolean) {
    if (role === 'admin' || allSites) return null;
    return fastify.repos.paymentRequests.getUserSiteIds(userId);
  }

  /* ---------- GET /api/rp — реестр РП ---------- */
  fastify.get('/api/rp', adminOrUser, async (request) => {
    const user = request.user!;
    const siteIds = await resolveSiteScope(user.id, user.role, user.allSites ?? false);
    return getRepo().listRegistry(siteIds);
  });

  /* ---------- GET /api/rp/documents — документы для модалки ---------- */
  fastify.get('/api/rp/documents', adminOrUser, async (request) => {
    const q = rpDocumentsQuerySchema.parse(request.query);
    return getRepo().getDocuments(q.supplierId, q.counterpartyId, q.siteId);
  });

  /* ---------- POST /api/rp — создать РП ---------- */
  fastify.post('/api/rp', adminOrUser, async (request, reply) => {
    const user = request.user!;
    const body = createRpBodySchema.parse(request.body);
    const row = await getRepo().create({
      supplierId: body.supplierId,
      counterpartyId: body.counterpartyId,
      siteId: body.siteId,
      paymentRequestIds: body.paymentRequestIds,
      documents: body.documents,
      letterDate: body.letterDate ?? null,
      createdBy: user.id,
    });
    return reply.status(201).send(row);
  });

  /* ---------- PATCH /api/rp/:id/status — смена статуса РП ---------- */
  fastify.patch('/api/rp/:id/status', adminOrUser, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateRpStatusBodySchema.parse(request.body);
    await getRepo().updateStatus(id, body.status);
    return { success: true };
  });
}

export default rpRoutes;
