import type { FastifyInstance } from 'fastify';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { authenticate } from '../middleware/authenticate.js';
import { config } from '../config.js';
import { sanitizeForS3 } from '../utils/sanitize.js';
import {
  acquireUploadSlot,
  releaseUploadSlot,
} from '../utils/uploadSemaphore.js';

/* ------------------------------------------------------------------ */
/*  Константы                                                          */
/* ------------------------------------------------------------------ */

/** Размер одного чанка (5 МБ — минимум для S3 multipart) */
const PART_SIZE = 5 * 1024 * 1024;

/** TTL сессии загрузки в Redis (1 час) */
const UPLOAD_SESSION_TTL = 3600;

/** Префикс ключей Redis для сессий загрузки */
const REDIS_PREFIX = 'upload:';

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
type UploadContext = 'request' | 'decision' | 'payment' | 'contract' | 'general';

/* ------------------------------------------------------------------ */
/*  Типы                                                               */
/* ------------------------------------------------------------------ */

interface InitBody {
  fileName: string;
  contentType: string;
  fileSize: number;
  context: UploadContext;
  counterpartyName?: string;
  requestNumber?: string;
  entityId?: string;
}

interface PartParams {
  uploadId: string;
  partNumber: string;
}

interface CompleteParams {
  uploadId: string;
}

interface StatusParams {
  uploadId: string;
}

interface DownloadParams {
  '*': string;
}

interface DownloadQuery {
  fileName?: string;
}

/** Данные сессии загрузки в Redis */
interface UploadSession {
  s3UploadId: string;
  fileKey: string;
  contentType: string;
  fileSize: number;
  totalParts: number;
  userId: string;
  /** ETags загруженных частей: { "1": "etag1", "2": "etag2" } */
  parts: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/*  JSON-схемы валидации                                               */
/* ------------------------------------------------------------------ */

const initSchema = {
  body: {
    type: 'object' as const,
    required: ['fileName', 'contentType', 'fileSize', 'context'],
    properties: {
      fileName: { type: 'string' as const, minLength: 1, maxLength: 255 },
      contentType: { type: 'string' as const, minLength: 1 },
      fileSize: { type: 'number' as const, minimum: 1 },
      context: {
        type: 'string' as const,
        enum: ['request', 'decision', 'payment', 'contract', 'general'],
      },
      counterpartyName: { type: 'string' as const, minLength: 1 },
      requestNumber: { type: 'string' as const, minLength: 1 },
      entityId: { type: 'string' as const, format: 'uuid' },
    },
  },
};

const partSchema = {
  params: {
    type: 'object' as const,
    required: ['uploadId', 'partNumber'],
    properties: {
      uploadId: { type: 'string' as const, minLength: 1 },
      partNumber: { type: 'string' as const, pattern: '^[1-9][0-9]*$' },
    },
  },
};

const completeSchema = {
  params: {
    type: 'object' as const,
    required: ['uploadId'],
    properties: {
      uploadId: { type: 'string' as const, minLength: 1 },
    },
  },
};

const statusSchema = {
  params: {
    type: 'object' as const,
    required: ['uploadId'],
    properties: {
      uploadId: { type: 'string' as const, minLength: 1 },
    },
  },
};

const downloadSchema = {
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

/* ------------------------------------------------------------------ */
/*  Вспомогательные функции                                            */
/* ------------------------------------------------------------------ */

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/** Генерирует S3-ключ на основе контекста загрузки */
function buildFileKey(body: InitBody): string {
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
  }
}

/** Получает папку контрагента по ID */
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

/** Проверяет принадлежность файла контрагенту */
async function verifyCounterpartyOwnership(
  fastify: FastifyInstance,
  fileKey: string,
  counterpartyId: string
): Promise<boolean> {
  if (fileKey.startsWith('approval-decisions/')) {
    return true;
  }
  const folder = await getCounterpartyFolder(fastify, counterpartyId);
  return fileKey.startsWith(`${folder}/`);
}

/** Читает сессию загрузки из Redis */
async function getSession(
  fastify: FastifyInstance,
  uploadId: string
): Promise<UploadSession | null> {
  const raw = await fastify.redis.get(`${REDIS_PREFIX}${uploadId}`);
  if (!raw) return null;
  return JSON.parse(raw) as UploadSession;
}

/** Сохраняет сессию загрузки в Redis */
async function saveSession(
  fastify: FastifyInstance,
  uploadId: string,
  session: UploadSession
): Promise<void> {
  await fastify.redis.set(
    `${REDIS_PREFIX}${uploadId}`,
    JSON.stringify(session),
    'EX',
    UPLOAD_SESSION_TTL
  );
}

/** Удаляет сессию загрузки из Redis */
async function deleteSession(
  fastify: FastifyInstance,
  uploadId: string
): Promise<void> {
  await fastify.redis.del(`${REDIS_PREFIX}${uploadId}`);
}

/* ------------------------------------------------------------------ */
/*  Маршруты                                                           */
/* ------------------------------------------------------------------ */

async function fileProxyRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * POST /api/files/upload/init
   * Инициализирует чанковую загрузку: валидирует, создаёт S3 multipart, сохраняет сессию в Redis
   */
  fastify.post<{ Body: InitBody }>(
    '/api/files/upload/init',
    {
      preHandler: [authenticate],
      schema: initSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const body = request.body;

      /** Валидация расширения */
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

      /** Валидация размера */
      const maxBytes = config.maxFileSizeMb * 1024 * 1024;
      if (body.fileSize > maxBytes) {
        return reply.status(400).send({
          error: `Размер файла превышает лимит ${config.maxFileSizeMb} МБ`,
        });
      }

      /** Проверка принадлежности контрагенту */
      if (user.role === 'counterparty_user') {
        if (!user.counterpartyId) {
          return reply.status(403).send({ error: 'Контрагент не привязан' });
        }
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

      /** Расчёт количества частей */
      const totalParts = Math.ceil(body.fileSize / PART_SIZE);

      /** Создаём S3 multipart upload */
      const createResult = await fastify.s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: fastify.s3Bucket,
          Key: fileKey,
          ContentType: body.contentType,
        })
      );

      const s3UploadId = createResult.UploadId;
      if (!s3UploadId) {
        return reply.status(500).send({ error: 'Ошибка создания multipart upload' });
      }

      /** Сохраняем сессию в Redis */
      const session: UploadSession = {
        s3UploadId,
        fileKey,
        contentType: body.contentType,
        fileSize: body.fileSize,
        totalParts,
        userId: user.id,
        parts: {},
      };

      /** Используем s3UploadId как ID сессии — он уникален */
      await saveSession(fastify, s3UploadId, session);

      return reply.send({
        uploadId: s3UploadId,
        fileKey,
        partSize: PART_SIZE,
        totalParts,
      });
    }
  );

  /**
   * PUT /api/files/upload/:uploadId/part/:partNumber
   * Загружает один чанк, стримит в S3 через UploadPartCommand
   */
  fastify.put<{ Params: PartParams }>(
    '/api/files/upload/:uploadId/part/:partNumber',
    {
      preHandler: [authenticate],
      schema: partSchema,
    },
    async (request, reply) => {
      const { uploadId, partNumber: partNumberStr } = request.params;
      const partNumber = parseInt(partNumberStr, 10);

      /** Проверяем сессию */
      const session = await getSession(fastify, uploadId);
      if (!session) {
        return reply.status(404).send({ error: 'Сессия загрузки не найдена или истекла' });
      }

      /** Проверяем, что запрос от владельца сессии */
      if (session.userId !== request.user!.id) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }

      /** Проверяем номер части */
      if (partNumber < 1 || partNumber > session.totalParts) {
        return reply.status(400).send({
          error: `Номер части должен быть от 1 до ${session.totalParts}`,
        });
      }

      /** Проверяем семафор */
      if (!acquireUploadSlot()) {
        reply.header('Retry-After', '5');
        return reply.status(503).send({ error: 'Сервер перегружен, повторите позже' });
      }

      try {
        /** Собираем тело запроса в Buffer (до 5 МБ — допустимо) */
        const chunks: Buffer[] = [];
        for await (const chunk of request.raw) {
          chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks);

        if (body.length === 0) {
          return reply.status(400).send({ error: 'Пустое тело запроса' });
        }

        /** Загружаем часть в S3 */
        const uploadResult = await fastify.s3Client.send(
          new UploadPartCommand({
            Bucket: fastify.s3Bucket,
            Key: session.fileKey,
            UploadId: session.s3UploadId,
            PartNumber: partNumber,
            Body: body,
          })
        );

        const etag = uploadResult.ETag;
        if (!etag) {
          return reply.status(500).send({ error: 'S3 не вернул ETag для части' });
        }

        /** Сохраняем ETag в сессию */
        session.parts[String(partNumber)] = etag;
        await saveSession(fastify, uploadId, session);

        return reply.send({ partNumber, etag });
      } finally {
        releaseUploadSlot();
      }
    }
  );

  /**
   * POST /api/files/upload/:uploadId/complete
   * Завершает multipart upload в S3, удаляет сессию из Redis
   */
  fastify.post<{ Params: CompleteParams }>(
    '/api/files/upload/:uploadId/complete',
    {
      preHandler: [authenticate],
      schema: completeSchema,
    },
    async (request, reply) => {
      const { uploadId } = request.params;

      const session = await getSession(fastify, uploadId);
      if (!session) {
        return reply.status(404).send({ error: 'Сессия загрузки не найдена или истекла' });
      }

      if (session.userId !== request.user!.id) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }

      /** Проверяем, что все части загружены */
      const uploadedParts = Object.keys(session.parts).map(Number).sort((a, b) => a - b);
      if (uploadedParts.length !== session.totalParts) {
        const missing = [];
        for (let i = 1; i <= session.totalParts; i++) {
          if (!session.parts[String(i)]) missing.push(i);
        }
        return reply.status(400).send({
          error: `Не все части загружены. Отсутствуют: ${missing.join(', ')}`,
        });
      }

      /** Собираем список частей для CompleteMultipartUpload */
      const parts = uploadedParts.map((num) => ({
        PartNumber: num,
        ETag: session.parts[String(num)],
      }));

      try {
        await fastify.s3Client.send(
          new CompleteMultipartUploadCommand({
            Bucket: fastify.s3Bucket,
            Key: session.fileKey,
            UploadId: session.s3UploadId,
            MultipartUpload: { Parts: parts },
          })
        );
      } catch (err) {
        request.log.error({ err }, 'Ошибка завершения multipart upload');

        /** Пробуем прервать загрузку в S3 */
        try {
          await fastify.s3Client.send(
            new AbortMultipartUploadCommand({
              Bucket: fastify.s3Bucket,
              Key: session.fileKey,
              UploadId: session.s3UploadId,
            })
          );
        } catch {
          // S3 lifecycle rule очистит незавершённые загрузки
        }

        await deleteSession(fastify, uploadId);
        return reply.status(500).send({ error: 'Ошибка сборки файла в хранилище' });
      }

      /** Получаем реальный размер файла из S3 */
      let actualSize = session.fileSize;
      try {
        const head = await fastify.s3Client.send(
          new HeadObjectCommand({
            Bucket: fastify.s3Bucket,
            Key: session.fileKey,
          })
        );
        if (head.ContentLength) {
          actualSize = head.ContentLength;
        }
      } catch {
        // Используем заявленный размер
      }

      await deleteSession(fastify, uploadId);

      return reply.send({
        fileKey: session.fileKey,
        fileSize: actualSize,
        mimeType: session.contentType,
      });
    }
  );

  /**
   * GET /api/files/upload/:uploadId/status
   * Возвращает статус сессии загрузки для resume
   */
  fastify.get<{ Params: StatusParams }>(
    '/api/files/upload/:uploadId/status',
    {
      preHandler: [authenticate],
      schema: statusSchema,
    },
    async (request, reply) => {
      const { uploadId } = request.params;

      const session = await getSession(fastify, uploadId);
      if (!session) {
        return reply.status(404).send({ error: 'Сессия загрузки не найдена или истекла' });
      }

      if (session.userId !== request.user!.id) {
        return reply.status(403).send({ error: 'Доступ запрещён' });
      }

      const uploadedParts = Object.keys(session.parts).map(Number).sort((a, b) => a - b);

      return reply.send({
        uploadId,
        fileKey: session.fileKey,
        uploadedParts,
        totalParts: session.totalParts,
      });
    }
  );

  /**
   * GET /api/files/download/*
   * Стриминг файла из S3 клиенту через сервер (proxy)
   */
  fastify.get<{ Params: DownloadParams; Querystring: DownloadQuery }>(
    '/api/files/download/*',
    {
      preHandler: [authenticate],
      schema: downloadSchema,
    },
    async (request, reply) => {
      const user = request.user!;
      const fileKey = request.params['*'];

      if (!fileKey) {
        return reply.status(400).send({ error: 'fileKey обязателен' });
      }

      /** Проверка доступа для counterparty_user */
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

      /** Получаем метаданные файла */
      let contentLength: number | undefined;
      let contentType: string | undefined;
      try {
        const head = await fastify.s3Client.send(
          new HeadObjectCommand({
            Bucket: fastify.s3Bucket,
            Key: fileKey,
          })
        );
        contentLength = head.ContentLength;
        contentType = head.ContentType;
      } catch {
        return reply.status(404).send({ error: 'Файл не найден' });
      }

      /** Поддержка Range-запросов для докачки */
      const rangeHeader = request.headers.range;
      const getCommand: ConstructorParameters<typeof GetObjectCommand>[0] = {
        Bucket: fastify.s3Bucket,
        Key: fileKey,
      };
      if (rangeHeader) {
        getCommand.Range = rangeHeader;
      }

      const s3Response = await fastify.s3Client.send(
        new GetObjectCommand(getCommand)
      );

      if (!s3Response.Body) {
        return reply.status(500).send({ error: 'S3 вернул пустой ответ' });
      }

      /** Формируем заголовок Content-Disposition */
      const fileName = request.query.fileName;
      const disposition = fileName
        ? `attachment; filename="${encodeURIComponent(fileName)}"`
        : 'inline';

      /** Стримим ответ напрямую */
      const statusCode = rangeHeader && s3Response.ContentRange ? 206 : 200;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(statusCode, {
        'Content-Type': contentType || 'application/octet-stream',
        ...(contentLength !== undefined && !rangeHeader && { 'Content-Length': String(contentLength) }),
        ...(s3Response.ContentRange && { 'Content-Range': s3Response.ContentRange }),
        ...(s3Response.ContentLength !== undefined && rangeHeader && { 'Content-Length': String(s3Response.ContentLength) }),
        'Content-Disposition': disposition,
        'Accept-Ranges': 'bytes',
      });

      try {
        await pipeline(s3Response.Body as Readable, raw);
      } catch {
        // Клиент отключился mid-download — ничего не делаем
        raw.destroy();
      }
    }
  );
}

export default fileProxyRoutes;
