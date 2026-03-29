import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { toCamelCase } from './utils/caseTransform.js';

/** Плагины инфраструктуры */
import databasePlugin from './plugins/database.js';
import s3Plugin from './plugins/s3.js';
import redisPlugin from './plugins/redis.js';
import queuesPlugin from './plugins/queues.js';

/** Маршруты */
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import uploadProgressRoutes from './routes/upload-progress.js';
import referenceRoutes from './routes/references/index.js';
import settingsRoutes from './routes/settings.js';
import fieldOptionRoutes from './routes/field-options.js';
import userRoutes from './routes/users.js';

/** Маршруты бизнес-логики */
import paymentRequestRoutes from './routes/payment-requests.js';
import paymentRequestExtraRoutes from './routes/payment-requests-extra.js';
import contractRequestRoutes from './routes/contract-requests.js';
import approvalRoutes from './routes/approvals.js';
import approvalExtraRoutes from './routes/approval-extra.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import notificationActionRoutes from './routes/notification-actions.js';
import assignmentRoutes from './routes/assignments.js';
import omtsRpRoutes from './routes/omts-rp.js';
import paymentRoutes from './routes/payments.js';
import errorLogRoutes from './routes/error-logs.js';
import materialRoutes from './routes/materials.js';
import ocrRoutes from './routes/ocr.js';

/** Импорт типов для расширения FastifyInstance */
import './types/index.js';

async function bootstrap(): Promise<void> {
  const fastify = Fastify({
    /** Разрешаем пустое тело при Content-Type: application/json (POST без body) */
    allowEmptyBody: true,
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      /** Скрываем секреты из логов */
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.currentPassword',
        'body.newPassword',
      ],
      transport:
        config.nodeEnv !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  /** 1. CORS */
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  /** 2. Куки */
  await fastify.register(cookie);

  /** 3. Заголовки безопасности */
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
      },
    },
  });

  /** 4. Ограничение частоты запросов */
  await fastify.register(rateLimit, {
    max: 500,
    timeWindow: '1 minute',
  });

  /** Глобальный хук: конвертация ключей ответа в camelCase */
  fastify.addHook('preSerialization', async (_request, _reply, payload) => {
    if (payload && typeof payload === 'object') {
      return toCamelCase(payload);
    }
    return payload;
  });

  /** Плагины инфраструктуры */
  await fastify.register(databasePlugin);
  await fastify.register(s3Plugin);
  await fastify.register(redisPlugin);
  await fastify.register(queuesPlugin);

  /** Маршруты */
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(uploadProgressRoutes);
  await fastify.register(referenceRoutes);
  await fastify.register(settingsRoutes, { prefix: '/api/settings' });
  await fastify.register(fieldOptionRoutes, { prefix: '/api/references/field-options' });
  await fastify.register(userRoutes, { prefix: '/api/users' });

  /** Маршруты бизнес-логики */
  await fastify.register(paymentRequestRoutes);
  await fastify.register(paymentRequestExtraRoutes);
  await fastify.register(contractRequestRoutes);
  await fastify.register(approvalRoutes);
  await fastify.register(approvalExtraRoutes);
  await fastify.register(commentRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(notificationActionRoutes);
  await fastify.register(assignmentRoutes);
  await fastify.register(omtsRpRoutes);
  await fastify.register(paymentRoutes);
  await fastify.register(errorLogRoutes);
  await fastify.register(materialRoutes);
  await fastify.register(ocrRoutes);

  /** Запуск сервера */
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(
      `Сервер запущен на http://0.0.0.0:${config.port} (${config.nodeEnv})`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();
