import type { FastifyInstance } from 'fastify';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface SupplierIdParams {
  supplierId: string;
}

interface SupplierTypeParams {
  supplierId: string;
  typeId: string;
}

interface FileIdParams {
  fileId: string;
}

interface UpdateBody {
  isAvailable?: boolean;
  comment?: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const supplierIdSchema = {
  params: {
    type: 'object' as const,
    required: ['supplierId'],
    properties: {
      supplierId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

const supplierTypeSchema = {
  params: {
    type: 'object' as const,
    required: ['supplierId', 'typeId'],
    properties: {
      supplierId: { type: 'string' as const, format: 'uuid' },
      typeId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

const updateBodySchema = {
  body: {
    type: 'object' as const,
    properties: {
      isAvailable: { type: 'boolean' as const, nullable: true },
      comment: { type: 'string' as const, nullable: true },
    },
    additionalProperties: false,
  },
};

const fileIdSchema = {
  params: {
    type: 'object' as const,
    required: ['fileId'],
    properties: {
      fileId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов учредительных документов                          */
/* ------------------------------------------------------------------ */

async function foundingDocumentRoutes(fastify: FastifyInstance): Promise<void> {
  const preHandler = [authenticate, requireRole('admin', 'user')];

  /**
   * GET /api/founding-documents/:supplierId
   * Таблица учредительных документов для поставщика:
   * LEFT JOIN document_types (category='founding') с supplier_founding_documents
   */
  fastify.get<{ Params: SupplierIdParams }>(
    '/:supplierId',
    { schema: supplierIdSchema, preHandler },
    async (request, reply) => {
      const { supplierId } = request.params;

      // Получаем все виды учредительных документов
      const { data: types, error: typesError } = await fastify.supabase
        .from('document_types')
        .select('id, name')
        .eq('category', 'founding')
        .order('created_at', { ascending: true });

      if (typesError) {
        return reply.status(500).send({ error: typesError.message });
      }

      if (!types || types.length === 0) {
        return [];
      }

      // Получаем данные для этого поставщика
      const { data: docs, error: docsError } = await fastify.supabase
        .from('supplier_founding_documents')
        .select('id, founding_document_type_id, is_available, checked_by, checked_at, comment')
        .eq('supplier_id', supplierId);

      if (docsError) {
        return reply.status(500).send({ error: docsError.message });
      }

      // Собираем id записей для подсчета файлов
      const docIds = (docs ?? []).map((d: Record<string, unknown>) => d.id as string);

      // Подсчет файлов для каждой записи
      let fileCounts: Record<string, number> = {};
      if (docIds.length > 0) {
        const { data: counts, error: countError } = await fastify.supabase
          .from('founding_document_files')
          .select('supplier_founding_document_id')
          .in('supplier_founding_document_id', docIds);

        if (!countError && counts) {
          for (const row of counts) {
            const key = (row as Record<string, unknown>).supplier_founding_document_id as string;
            fileCounts[key] = (fileCounts[key] ?? 0) + 1;
          }
        }
      }

      // Собираем id пользователей для получения ФИО
      const userIds = (docs ?? [])
        .map((d: Record<string, unknown>) => d.checked_by as string)
        .filter(Boolean);

      let usersMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await fastify.supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds);

        if (users) {
          for (const u of users) {
            usersMap[(u as Record<string, unknown>).id as string] =
              (u as Record<string, unknown>).full_name as string;
          }
        }
      }

      // Маппинг по founding_document_type_id
      const docsMap = new Map<string, Record<string, unknown>>();
      for (const d of (docs ?? []) as Record<string, unknown>[]) {
        docsMap.set(d.founding_document_type_id as string, d);
      }

      // Формируем результат
      const result = types.map((t: Record<string, unknown>) => {
        const doc = docsMap.get(t.id as string);
        const docId = doc?.id as string | undefined;
        return {
          type_id: t.id,
          type_name: t.name,
          doc_id: docId ?? null,
          is_available: (doc?.is_available as boolean) ?? false,
          checked_by_name: doc?.checked_by ? usersMap[doc.checked_by as string] ?? null : null,
          checked_at: doc?.checked_at ?? null,
          comment: (doc?.comment as string) ?? '',
          file_count: docId ? (fileCounts[docId] ?? 0) : 0,
        };
      });

      return result;
    }
  );

  /**
   * PUT /api/founding-documents/:supplierId/:typeId
   * Upsert записи: is_available / comment
   */
  fastify.put<{ Params: SupplierTypeParams; Body: UpdateBody }>(
    '/:supplierId/:typeId',
    { schema: { ...supplierTypeSchema, ...updateBodySchema }, preHandler },
    async (request, reply) => {
      const { supplierId, typeId } = request.params;
      const user = request.user!;
      const body = request.body;

      // Проверяем существование записи
      const { data: existing } = await fastify.supabase
        .from('supplier_founding_documents')
        .select('id, is_available')
        .eq('supplier_id', supplierId)
        .eq('founding_document_type_id', typeId)
        .maybeSingle();

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (body.isAvailable !== undefined) {
        updates['is_available'] = body.isAvailable;
        if (body.isAvailable) {
          updates['checked_by'] = user.id;
          updates['checked_at'] = new Date().toISOString();
        } else {
          updates['checked_by'] = null;
          updates['checked_at'] = null;
        }
      }

      if (body.comment !== undefined) {
        updates['comment'] = body.comment;
      }

      if (existing) {
        // Обновляем
        const { data, error } = await fastify.supabase
          .from('supplier_founding_documents')
          .update(updates)
          .eq('id', (existing as Record<string, unknown>).id)
          .select('id')
          .single();

        if (error) return reply.status(500).send({ error: error.message });
        return { id: (data as Record<string, unknown>).id, updated: true };
      } else {
        // Создаем
        const insertData: Record<string, unknown> = {
          supplier_id: supplierId,
          founding_document_type_id: typeId,
          ...updates,
        };

        const { data, error } = await fastify.supabase
          .from('supplier_founding_documents')
          .insert(insertData)
          .select('id')
          .single();

        if (error) return reply.status(500).send({ error: error.message });
        return { id: (data as Record<string, unknown>).id, created: true };
      }
    }
  );

  /**
   * GET /api/founding-documents/:supplierId/:typeId/files
   * Список файлов учредительного документа
   */
  fastify.get<{ Params: SupplierTypeParams }>(
    '/:supplierId/:typeId/files',
    { schema: supplierTypeSchema, preHandler },
    async (request, reply) => {
      const { supplierId, typeId } = request.params;

      // Находим запись supplier_founding_documents
      const { data: doc } = await fastify.supabase
        .from('supplier_founding_documents')
        .select('id')
        .eq('supplier_id', supplierId)
        .eq('founding_document_type_id', typeId)
        .maybeSingle();

      if (!doc) {
        return [];
      }

      const docId = (doc as Record<string, unknown>).id as string;

      const { data: files, error } = await fastify.supabase
        .from('founding_document_files')
        .select('id, file_name, file_key, file_size, mime_type, comment, created_by, created_at')
        .eq('supplier_founding_document_id', docId)
        .order('created_at', { ascending: false });

      if (error) {
        return reply.status(500).send({ error: error.message });
      }

      // Получаем ФИО загрузивших
      const userIds = (files ?? [])
        .map((f: Record<string, unknown>) => f.created_by as string)
        .filter(Boolean);

      let usersMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: users } = await fastify.supabase
          .from('users')
          .select('id, full_name')
          .in('id', [...new Set(userIds)]);

        if (users) {
          for (const u of users) {
            usersMap[(u as Record<string, unknown>).id as string] =
              (u as Record<string, unknown>).full_name as string;
          }
        }
      }

      return (files ?? []).map((f: Record<string, unknown>) => ({
        ...f,
        created_by_name: usersMap[f.created_by as string] ?? null,
      }));
    }
  );

  /**
   * DELETE /api/founding-documents/files/:fileId
   * Удаление файла (S3 + БД)
   */
  fastify.delete<{ Params: FileIdParams }>(
    '/files/:fileId',
    { schema: fileIdSchema, preHandler },
    async (request, reply) => {
      const { fileId } = request.params;

      // Получаем запись файла
      const { data: file, error: fetchError } = await fastify.supabase
        .from('founding_document_files')
        .select('id, file_key')
        .eq('id', fileId)
        .maybeSingle();

      if (fetchError) {
        return reply.status(500).send({ error: fetchError.message });
      }

      if (!file) {
        return reply.status(404).send({ error: 'Файл не найден' });
      }

      const fileKey = (file as Record<string, unknown>).file_key as string;

      // Удаляем из S3
      try {
        await fastify.s3Client.send(
          new DeleteObjectCommand({
            Bucket: fastify.s3Bucket,
            Key: fileKey,
          })
        );
      } catch (err) {
        request.log.warn({ err, fileKey }, 'Не удалось удалить файл из S3');
      }

      // Удаляем из БД
      const { error: deleteError } = await fastify.supabase
        .from('founding_document_files')
        .delete()
        .eq('id', fileId);

      if (deleteError) {
        return reply.status(500).send({ error: deleteError.message });
      }

      return { success: true };
    }
  );
}

export default foundingDocumentRoutes;
