import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';
import { SB_REVIEW_CUTOFF_DATE } from '../../config/sbReview.js';
import {
  createSupplierBodySchema,
  updateSupplierBodySchema,
  supplierSecurityDecisionBodySchema,
} from '../../schemas/supplier.js';
import { nonEmptyString } from '../../schemas/common.js';

/* ------------------------------------------------------------------ */
/*  Параметры пути, query и тела                                       */
/* ------------------------------------------------------------------ */

interface IdParams {
  id: string;
}

interface ListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  sbFilter?: 'all' | 'pending';
}

const idParamsSchema = {
  params: {
    type: 'object' as const,
    required: ['id'],
    properties: { id: { type: 'string' as const, minLength: 1 } },
  },
};

const batchImportBodySchema = z.object({
  rows: z.array(z.object({ name: nonEmptyString, inn: nonEmptyString })).min(1),
});

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов поставщиков (через fastify.repos)                 */
/* ------------------------------------------------------------------ */

async function supplierRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /api/references/suppliers — список поставщиков.
   *  Без query.page — обратно-совместимый массив; с query.page — серверная пагинация + СБ-агрегаты. */
  fastify.get<{ Querystring: ListQuery }>(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user', 'counterparty_user', 'security')] },
    async (request) => {
      const repo = request.server.repos.suppliers;
      const { page: pageRaw, pageSize: pageSizeRaw, search, sbFilter } = request.query;

      if (pageRaw === undefined) {
        return repo.listAll();
      }

      const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeRaw ?? '20', 10) || 20));
      const filter: 'all' | 'pending' = sbFilter === 'pending' ? 'pending' : 'all';

      const { items, total } = await repo.listForApi({
        page,
        pageSize,
        search,
        sbFilter: filter,
        cutoffDate: SB_REVIEW_CUTOFF_DATE,
      });
      return { items, total, page, pageSize };
    },
  );

  /** GET /api/references/suppliers/:id — один поставщик */
  fastify.get<{ Params: IdParams }>(
    '/:id',
    {
      schema: idParamsSchema,
      preHandler: [authenticate, requireRole('admin', 'user', 'security')],
    },
    async (request) => {
      return request.server.repos.suppliers.getById(request.params.id);
    },
  );

  /** POST /api/references/suppliers — создание поставщика */
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const body = createSupplierBodySchema.parse(request.body);
      return request.server.repos.suppliers.create(body);
    },
  );

  /** PUT /api/references/suppliers/:id — обновление поставщика */
  fastify.put<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const body = updateSupplierBodySchema.parse(request.body);
      return request.server.repos.suppliers.update(request.params.id, body);
    },
  );

  /** DELETE /api/references/suppliers/:id — удаление поставщика */
  fastify.delete<{ Params: IdParams }>(
    '/:id',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      await request.server.repos.suppliers.delete(request.params.id);
      return { success: true };
    },
  );

  /** POST /api/references/suppliers/batch-import — пакетный импорт */
  fastify.post(
    '/batch-import',
    { preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const { rows } = batchImportBodySchema.parse(request.body);
      const created = await request.server.repos.suppliers.batchCreate(rows);
      return { created };
    },
  );

  /* ---------------------------------------------------------------- */
  /*  Проверки СБ: история событий и создание новых                    */
  /* ---------------------------------------------------------------- */

  /** GET /api/references/suppliers/:id/security-checks — история событий по поставщику */
  fastify.get<{ Params: IdParams }>(
    '/:id/security-checks',
    {
      schema: idParamsSchema,
      preHandler: [authenticate, requireRole('admin', 'user', 'security')],
    },
    async (request) => {
      return request.server.repos.suppliers.getSecurityHistory(request.params.id);
    },
  );

  /** POST /api/references/suppliers/:id/security-checks/request — отправка на проверку (admin/user) */
  fastify.post<{ Params: IdParams }>(
    '/:id/security-checks/request',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('admin', 'user')] },
    async (request) => {
      const user = request.user!;
      return request.server.repos.suppliers.requestSecurityCheck(request.params.id, {
        id: user.id,
        fullName: user.fullName,
      });
    },
  );

  /** POST /api/references/suppliers/:id/security-checks/decision — решение СБ (security) */
  fastify.post<{ Params: IdParams }>(
    '/:id/security-checks/decision',
    { schema: idParamsSchema, preHandler: [authenticate, requireRole('security')] },
    async (request) => {
      const user = request.user!;
      const body = supplierSecurityDecisionBodySchema.parse(request.body);
      return request.server.repos.suppliers.decideSecurityCheck(
        request.params.id,
        { id: user.id, fullName: user.fullName },
        body,
      );
    },
  );
}

export default supplierRoutes;
