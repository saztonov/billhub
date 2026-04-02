import type { FastifyInstance } from 'fastify';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { config } from '../config.js';
import { sanitizeForS3 } from '../utils/sanitize.js';

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

/** Допустимые расширения файлов */
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'dwg',
]);

/** Допустимые MIME-типы */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/bmp',
  'application/acad',
  'application/x-acad',
  'image/vnd.dwg',
  'application/dwg',
  'application/octet-stream',
]);

/** Контексты загрузки файлов */
type UploadContext = 'request' | 'decision' | 'payment' | 'contract' | 'general' | 'founding';

/** Таблицы метаданных файлов */
type FileEntityType =
  | 'payment_request_files'
  | 'approval_decision_files'
  | 'contract_request_files'
  | 'payment_payment_files'
  | 'founding_document_files';

/** Маппинг entityType -> поле внешнего ключа */
const ENTITY_FK_MAP: Record<FileEntityType, string> = {
  payment_request_files: 'payment_request_id',
  approval_decision_files: 'approval_decision_id',
  contract_request_files: 'contract_request_id',
  payment_payment_files: 'payment_payment_id',
  founding_document_files: 'supplier_founding_document_id',
};

/* ------------------------------------------------------------------ */
/*  Типы тел запросов                                                  */
/* ------------------------------------------------------------------ */

interface UploadUrlBody {
  fileName: string;
  contentType: string;
  context: UploadContext;
  counterpartyName?: string;
  requestNumber?: string;
  entityId?: string;
}

interface ConfirmBody {
  fileKey: string;
  entityType: FileEntityType;
  entityId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number;
  documentTypeId?: string;
  isResubmit?: boolean;
  isAdditional?: boolean;
  comment?: string;
}

interface DownloadUrlParams {
  '*': string;
}

interface DownloadUrlQuery {
  fileName?: string;
}

interface DeleteParams {
  '*': string;
}

interface DeleteQuery {
  entityType?: FileEntityType;
  entityId?: string;
}

interface ListParams {
  counterpartyName: string;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const uploadUrlSchema = {
  body: {
    type: 'object' as const,
    required: ['fileName', 'contentType', 'context'],
    properties: {
      fileName: { type: 'string' as const, minLength: 1, maxLength: 255 },
      contentType: { type: 'string' as const, minLength: 1 },
      context: {
        type: 'string' as const,
        enum: ['request', 'decision', 'payment', 'contract', 'general', 'founding'],
      },
      counterpartyName: { type: 'string' as const, minLength: 1 },
      requestNumber: { type: 'string' as const, minLength: 1 },
      entityId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

const confirmSchema = {
  body: {
    type: 'object' as const,
    required: ['fileKey', 'entityType', 'entityId', 'fileName', 'fileSize', 'mimeType'],
    properties: {
      fileKey: { type: 'string' as const, minLength: 1 },
      entityType: {
        type: 'string' as const,
        enum: [
          'payment_request_files',
          'approval_decision_files',
          'contract_request_files',
          'payment_payment_files',
          'founding_document_files',
        ],
      },
      entityId: { type: 'string' as const, format: 'uuid' },
      fileName: { type: 'string' as const, minLength: 1, maxLength: 255 },
      fileSize: { type: 'number' as const, minimum: 1 },
      mimeType: { type: 'string' as const, minLength: 1 },
      pageCount: { type: 'number' as const, minimum: 0, nullable: true },
      documentTypeId: { type: 'string' as const, format: 'uuid', nullable: true },
      isResubmit: { type: 'boolean' as const, nullable: true },
      isAdditional: { type: 'boolean' as const, nullable: true },
      comment: { type: 'string' as const, nullable: true },
    },
  },
};

const downloadUrlSchema = {
  params: {
    type: 'object' as const,
    properties: {
      '*': { type: 'string' as const, minLength: 1 },
    },
  },
  querystring: {
    type: 'object' as const,
    properties: {
      fileName: { type: 'string' as const },
    },
  },
};

const deleteSchema = {
  params: {
    type: 'object' as const,
    properties: {
      '*': { type: 'string' as const, minLength: 1 },
    },
  },
  querystring: {
    type: 'object' as const,
    properties: {
      entityType: {
        type: 'string' as const,
        enum: [
          'payment_request_files',
          'approval_decision_files',
          'contract_request_files',
          'payment_payment_files',
          'founding_document_files',
        ],
        nullable: true,
      },
      entityId: { type: 'string' as const, format: 'uuid', nullable: true },
    },
  },
};

const listSchema = {
  params: {
    type: 'object' as const,
    required: ['counterpartyName'],
    properties: {
      counterpartyName: { type: 'string' as const, minLength: 1 },
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

/** Извлекает расширение файла в нижнем регистре */
function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/** Генерирует S3-ключ на основе контекста загрузки */
function buildFileKey(body: UploadUrlBody): string {
  const safeName = sanitizeForS3(body.fileName);
  const timestamp = Date.now();

  switch (body.context) {
    case 'request': {
      if (!body.counterpartyName || !body.requestNumber) {
        throw new Error('counterpartyName и requestNumber обязательны для контекста request');
      }
      const folder = sanitizeForS3(body.counterpartyName);
      const number = sanitizeForS3(body.requestNumber);
      return `${folder}/${number}/${timestamp}_${safeName}`;
    }
    case 'decision': {
      if (!body.entityId) {
        throw new Error('entityId обязателен для контекста decision');
      }
      return `approval-decisions/${body.entityId}/${timestamp}_${safeName}`;
    }
    case 'payment': {
      if (!body.counterpartyName || !body.entityId) {
        throw new Error('counterpartyName и entityId обязательны для контекста payment');
      }
      const folder = sanitizeForS3(body.counterpartyName);
      return `${folder}/payment/${body.entityId}/${timestamp}_${safeName}`;
    }
    case 'contract': {
      if (!body.counterpartyName || !body.entityId) {
        throw new Error('counterpartyName и entityId обязательны для контекста contract');
      }
      const folder = sanitizeForS3(body.counterpartyName);
      return `${folder}/contract/${body.entityId}/${timestamp}_${safeName}`;
    }
    case 'general': {
      if (!body.counterpartyName) {
        throw new Error('counterpartyName обязателен для контекста general');
      }
      const folder = sanitizeForS3(body.counterpartyName);
      return `${folder}/${timestamp}_${safeName}`;
    }
    case 'founding': {
      if (!body.entityId) {
        throw new Error('entityId обязателен для контекста founding');
      }
      return `founding-docs/${body.entityId}/${timestamp}_${safeName}`;
    }
  }
}

/**
 * Для counterparty_user получает имя контрагента по counterpartyId.
 * Возвращает санитизированную папку контрагента.
 */
async function getCounterpartyFolder(
  fastify: FastifyInstance,
  counterpartyId: string
): Promise<string> {
  const { data, error } = await fastify.supabase
    .from('counterparties')
    .select('name')
    .eq('id', counterpartyId)
    .single();

  if (error || !data) {
    throw new Error('Контрагент не найден');
  }

  return sanitizeForS3(data.name as string);
}

/**
 * Проверяет, что файл принадлежит контрагенту пользователя.
 * Для контекста decision — проверка не требуется (общая папка).
 */
async function verifyCounterpartyOwnership(
  fastify: FastifyInstance,
  fileKey: string,
  counterpartyId: string
): Promise<boolean> {
  /** Файлы решений по согласованиям доступны всем авторизованным */
  if (fileKey.startsWith('approval-decisions/')) {
    return true;
  }

  const folder = await getCounterpartyFolder(fastify, counterpartyId);
  return fileKey.startsWith(`${folder}/`);
}

/* ------------------------------------------------------------------ */
/*  Маршруты                                                           */
/* ------------------------------------------------------------------ */

async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/files/upload-url
   * Генерирует presigned PUT URL для загрузки файла в S3
   */
  fastify.post<{ Body: UploadUrlBody }>(
    '/api/files/upload-url',
    {
      preHandler: [authenticate],
      schema: uploadUrlSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body;

      /** Валидация расширения файла */
      const ext = getFileExtension(body.fileName);
      if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
        return reply.status(400).send({
          error: `Недопустимое расширение файла: .${ext || '(нет)'}`,
        });
      }

      /** Валидация MIME-типа */
      if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
        return reply.status(400).send({
          error: `Недопустимый тип файла: ${body.contentType}`,
        });
      }

      /** Для counterparty_user проверяем принадлежность к контрагенту */
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }

        /** Если указано counterpartyName, проверяем что оно совпадает */
        if (body.counterpartyName) {
          const folder = await getCounterpartyFolder(fastify, user.counterpartyId);
          const requestedFolder = sanitizeForS3(body.counterpartyName);
          if (folder !== requestedFolder) {
            return reply.status(403).send({ error: 'Доступ запрещён' });
          }
        }
      }

      /** Генерация S3-ключа */
      let fileKey: string;
      try {
        fileKey = buildFileKey(body);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ошибка генерации ключа';
        return reply.status(400).send({ error: message });
      }

      /** Генерация presigned PUT URL */
      const command = new PutObjectCommand({
        Bucket: fastify.s3Bucket,
        Key: fileKey,
        ContentType: body.contentType,
      });

      const uploadUrl = await getSignedUrl(fastify.s3Client, command, {
        expiresIn: 300,
      });

      return reply.send({ uploadUrl, fileKey });
    }
  );

  /**
   * POST /api/files/confirm
   * Подтверждает загрузку файла: проверяет наличие в S3, сохраняет метаданные в БД
   */
  fastify.post<{ Body: ConfirmBody }>(
    '/api/files/confirm',
    {
      preHandler: [authenticate],
      schema: confirmSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body;

      /** Для counterparty_user проверяем принадлежность файла */
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }
        const isOwner = await verifyCounterpartyOwnership(
          fastify, body.fileKey, user.counterpartyId
        );
        if (!isOwner) {
          return reply.status(403).send({ error: 'Доступ запрещён' });
        }
      }

      /** Проверяем существование файла в S3 */
      try {
        await fastify.s3Client.send(
          new HeadObjectCommand({
            Bucket: fastify.s3Bucket,
            Key: body.fileKey,
          })
        );
      } catch {
        return reply.status(404).send({ error: 'Файл не найден в хранилище' });
      }

      /** Проверяем размер файла */
      const maxBytes = config.maxFileSizeMb * 1024 * 1024;
      if (body.fileSize > maxBytes) {
        return reply.status(400).send({
          error: `Размер файла превышает лимит ${config.maxFileSizeMb} МБ`,
        });
      }

      /** Формируем запись для вставки */
      const fkField = ENTITY_FK_MAP[body.entityType];

      const record: Record<string, unknown> = {
        [fkField]: body.entityId,
        file_name: body.fileName,
        file_key: body.fileKey,
        file_size: body.fileSize,
        mime_type: body.mimeType,
        created_by: user.id,
      };

      /** Дополнительные поля для payment_request_files */
      if (body.entityType === 'payment_request_files') {
        if (body.documentTypeId) record['document_type_id'] = body.documentTypeId;
        if (body.pageCount !== undefined) record['page_count'] = body.pageCount;
        if (body.isResubmit !== undefined) record['is_resubmit'] = body.isResubmit;
        if (body.isAdditional !== undefined) record['is_additional'] = body.isAdditional;
      }

      /** Дополнительные поля для contract_request_files */
      if (body.entityType === 'contract_request_files') {
        if (body.isAdditional !== undefined) record['is_additional'] = body.isAdditional;
      }

      /** Дополнительные поля для founding_document_files */
      if (body.entityType === 'founding_document_files') {
        if (body.comment !== undefined) record['comment'] = body.comment;
      }

      /** Вставляем метаданные в соответствующую таблицу */
      const { data, error } = await fastify.supabase
        .from(body.entityType)
        .insert(record)
        .select('id, file_key')
        .single();

      if (error) {
        request.log.error({ error }, 'Ошибка сохранения метаданных файла');
        return reply.status(500).send({ error: 'Ошибка сохранения метаданных файла' });
      }

      /** Ставим задачу обработки файла в очередь */
      const job = await fastify.fileProcessingQueue.add('process-file', {
        entityType: body.entityType,
        entityId: body.entityId,
        fileId: data.id as string,
        fileKey: body.fileKey,
        userId: user.id,
      });

      return reply.send({
        id: data.id as string,
        fileKey: data.file_key as string,
        jobId: job.id,
      });
    }
  );

  /**
   * GET /api/files/download-url/*
   * Генерирует presigned GET URL для скачивания файла из S3
   */
  fastify.get<{ Params: DownloadUrlParams; Querystring: DownloadUrlQuery }>(
    '/api/files/download-url/*',
    {
      preHandler: [authenticate],
      schema: downloadUrlSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const fileKey = request.params['*'];

      if (!fileKey) {
        return reply.status(400).send({ error: 'fileKey обязателен' });
      }

      /** Для counterparty_user проверяем принадлежность файла */
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }
        const isOwner = await verifyCounterpartyOwnership(
          fastify, fileKey, user.counterpartyId
        );
        if (!isOwner) {
          return reply.status(403).send({ error: 'Доступ запрещён' });
        }
      }

      /** Формируем заголовок для принудительного скачивания */
      const fileName = request.query.fileName;
      const responseDisposition = fileName
        ? `attachment; filename="${encodeURIComponent(fileName)}"`
        : undefined;

      const command = new GetObjectCommand({
        Bucket: fastify.s3Bucket,
        Key: fileKey,
        ResponseContentDisposition: responseDisposition,
      });

      const downloadUrl = await getSignedUrl(fastify.s3Client, command, {
        expiresIn: 3600,
      });

      return reply.send({ downloadUrl });
    }
  );

  /**
   * DELETE /api/files/*
   * Удаляет файл из S3 и опционально метаданные из БД
   */
  fastify.delete<{ Params: DeleteParams; Querystring: DeleteQuery }>(
    '/api/files/*',
    {
      preHandler: [authenticate],
      schema: deleteSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const fileKey = request.params['*'];

      if (!fileKey) {
        return reply.status(400).send({ error: 'fileKey обязателен' });
      }

      /** Для counterparty_user проверяем принадлежность файла */
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }
        const isOwner = await verifyCounterpartyOwnership(
          fastify, fileKey, user.counterpartyId
        );
        if (!isOwner) {
          return reply.status(403).send({ error: 'Доступ запрещён' });
        }
      }

      /** Удаляем файл из S3 */
      try {
        await fastify.s3Client.send(
          new DeleteObjectCommand({
            Bucket: fastify.s3Bucket,
            Key: fileKey,
          })
        );
      } catch (err) {
        request.log.error({ err, fileKey }, 'Ошибка удаления файла из S3');
        return reply.status(500).send({ error: 'Ошибка удаления файла' });
      }

      /** Удаляем метаданные из БД, если указан entityType и entityId */
      const { entityType, entityId } = request.query;
      if (entityType && entityId) {
        const fkField = ENTITY_FK_MAP[entityType];
        if (fkField) {
          const { error } = await fastify.supabase
            .from(entityType)
            .delete()
            .eq(fkField, entityId)
            .eq('file_key', fileKey);

          if (error) {
            request.log.error({ error }, 'Ошибка удаления метаданных файла');
          }
        }
      }

      return reply.send({ success: true });
    }
  );

  /**
   * GET /api/files/list/:counterpartyName
   * Список файлов контрагента в S3
   */
  fastify.get<{ Params: ListParams }>(
    '/api/files/list/:counterpartyName',
    {
      preHandler: [authenticate, requireRole('admin', 'user')],
      schema: listSchema,
    },
    async (request, reply) => {
      const folder = sanitizeForS3(request.params.counterpartyName);

      const command = new ListObjectsV2Command({
        Bucket: fastify.s3Bucket,
        Prefix: `${folder}/`,
      });

      const response = await fastify.s3Client.send(command);

      const files = (response.Contents ?? []).map((item) => ({
        key: item.Key ?? '',
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null,
      }));

      return reply.send({ files });
    }
  );

  /**
   * GET /api/files/test-connection
   * Проверка подключения к S3 хранилищу (админ)
   */
  fastify.get(
    '/api/files/test-connection',
    { preHandler: [authenticate, requireRole('admin')] },
    async (_request, reply) => {
      const command = new ListObjectsV2Command({
        Bucket: fastify.s3Bucket,
        MaxKeys: 1,
      });

      await fastify.s3Client.send(command);

      return reply.send({ ok: true, provider: config.storageProvider });
    },
  );
}

export default fileRoutes;
