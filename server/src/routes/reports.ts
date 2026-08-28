import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { savingsReportQuerySchema } from '../schemas/report.js';
import { getSavingsReport } from '../services/reports/savings-report.service.js';

/* ------------------------------------------------------------------ */
/*  Маршруты отчётов админки. Только Drizzle (без Supabase).           */
/* ------------------------------------------------------------------ */

async function reportRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /** Drizzle-инстанс БД (отчёты считаются одним SQL-запросом). */
  function getDb() {
    const db = fastify.db;
    if (!db) {
      throw new Error(
        'Маршруты отчётов требуют DB_PROVIDER=drizzle (fastify.db не инициализирован).',
      );
    }
    return db;
  }

  /* ---------- GET /api/reports/savings ---------- */
  fastify.get('/api/reports/savings', adminOnly, async (request) => {
    const query = savingsReportQuerySchema.parse(request.query);
    return getSavingsReport(getDb(), query);
  });
}

export default reportRoutes;
