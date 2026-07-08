/**
 * Плагин Fastify, регистрирующий слой репозиториев в зависимости от feature-флага DB_PROVIDER.
 *
 * Поведение:
 *  - В production (`NODE_ENV=production`) ОБЯЗАТЕЛЬНО `DB_PROVIDER=drizzle` — startup-инвариант
 *    (включается с Iteration 5; в Iteration 4 default = supabase). По принципу 2 плана.
 *  - DB_PROVIDER=supabase → SupabaseRepository (через fastify.supabase).
 *  - DB_PROVIDER=drizzle → DrizzleRepository (через fastify.db, см. database-drizzle плагин).
 *
 * Использование в роутах:
 *   const cp = await request.server.repos.counterparties.getById(id)
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../repositories/index.js';
import { SupabaseCounterpartyRepository } from '../repositories/supabase/counterparty.supabase.js';
import { SupabaseSupplierRepository } from '../repositories/supabase/supplier.supabase.js';
import { SupabaseUserRepository } from '../repositories/supabase/user.supabase.js';
import { SupabaseReferenceRepository } from '../repositories/supabase/reference.supabase.js';
import { SupabaseNotificationRepository } from '../repositories/supabase/notification.supabase.js';
import { SupabaseCommentRepository } from '../repositories/supabase/comment.supabase.js';
import { SupabaseNotificationActionRepository } from '../repositories/supabase/notification-action.supabase.js';
import { SupabaseFileRepository } from '../repositories/supabase/file.supabase.js';
import { SupabasePaymentRequestRepository } from '../repositories/supabase/payment-request.supabase.js';
import { SupabaseContractRequestRepository } from '../repositories/supabase/contract-request.supabase.js';
import { SupabasePaymentRepository } from '../repositories/supabase/payment.supabase.js';
import { SupabaseApprovalRepository } from '../repositories/supabase/approval.supabase.js';
import { SupabaseAssignmentRepository } from '../repositories/supabase/assignment.supabase.js';
import { SupabaseErrorLogRepository } from '../repositories/supabase/error-log.supabase.js';
import { SupabaseOcrModelRepository } from '../repositories/supabase/ocr-model.supabase.js';
import { SupabaseRpStageRepository } from '../repositories/supabase/rp-stage.supabase.js';
import { SupabaseMaterialRepository } from '../repositories/supabase/material.supabase.js';
import { SupabaseFoundingDocumentRepository } from '../repositories/supabase/founding-document.supabase.js';
import { SupabaseOcrRepository } from '../repositories/supabase/ocr.supabase.js';
import { DrizzleCounterpartyRepository } from '../repositories/drizzle/counterparty.drizzle.js';
import { DrizzleSupplierRepository } from '../repositories/drizzle/supplier.drizzle.js';
import { DrizzleUserRepository } from '../repositories/drizzle/user.drizzle.js';
import { DrizzleReferenceRepository } from '../repositories/drizzle/reference.drizzle.js';
import { DrizzleNotificationRepository } from '../repositories/drizzle/notification.drizzle.js';
import { DrizzleCommentRepository } from '../repositories/drizzle/comment.drizzle.js';
import { DrizzleNotificationActionRepository } from '../repositories/drizzle/notification-action.drizzle.js';
import { DrizzleFileRepository } from '../repositories/drizzle/file.drizzle.js';
import { DrizzlePaymentRequestRepository } from '../repositories/drizzle/payment-request.drizzle.js';
import { DrizzleContractRequestRepository } from '../repositories/drizzle/contract-request.drizzle.js';
import { DrizzlePaymentRepository } from '../repositories/drizzle/payment.drizzle.js';
import { DrizzleApprovalRepository } from '../repositories/drizzle/approval.drizzle.js';
import { DrizzleAssignmentRepository } from '../repositories/drizzle/assignment.drizzle.js';
import { DrizzleErrorLogRepository } from '../repositories/drizzle/error-log.drizzle.js';
import { DrizzleOcrModelRepository } from '../repositories/drizzle/ocr-model.drizzle.js';
import { DrizzleRpStageRepository } from '../repositories/drizzle/rp-stage.drizzle.js';
import { DrizzleMaterialRepository } from '../repositories/drizzle/material.drizzle.js';
import { DrizzleFoundingDocumentRepository } from '../repositories/drizzle/founding-document.drizzle.js';
import { DrizzleOcrRepository } from '../repositories/drizzle/ocr.drizzle.js';
import { DrizzleOutboxRepository } from '../repositories/drizzle/outbox.drizzle.js';
import { DrizzleAuditLogRepository } from '../repositories/drizzle/audit-log.drizzle.js';
import { DrizzleJobsLogRepository } from '../repositories/drizzle/jobs-log.drizzle.js';
import { SupabaseOutboxRepository } from '../repositories/supabase/outbox.supabase.js';
import { SupabaseAuditLogRepository } from '../repositories/supabase/audit-log.supabase.js';
import { SupabaseJobsLogRepository } from '../repositories/supabase/jobs-log.supabase.js';

declare module 'fastify' {
  interface FastifyInstance {
    repos: Repositories;
    dbProvider: 'supabase' | 'drizzle';
  }
}

export type DbProvider = 'supabase' | 'drizzle';

/**
 * Резолюция провайдера из env с проверкой production-инварианта.
 * Экспортируется для тестов.
 */
export function resolveDbProvider(env: NodeJS.ProcessEnv): DbProvider {
  // Iteration 5 (cutover): default = drizzle. Supabase остаётся явным rollback-провайдером
  // (DB_PROVIDER=supabase). В production drizzle обязателен (startup-инвариант ниже).
  const provider = (env.DB_PROVIDER ?? 'drizzle') as DbProvider;
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (provider !== 'supabase' && provider !== 'drizzle') {
    throw new Error(
      `Недопустимое значение DB_PROVIDER=${provider}. Ожидается "supabase" или "drizzle".`,
    );
  }

  if (nodeEnv === 'production' && provider !== 'drizzle') {
    throw new Error(
      `В production обязателен DB_PROVIDER=drizzle (см. ADR-0001, принцип 2 плана). ` +
        `Получено: DB_PROVIDER=${provider}.`,
    );
  }

  return provider;
}

async function repositoriesPlugin(fastify: FastifyInstance): Promise<void> {
  const provider = resolveDbProvider(process.env);

  fastify.decorate('dbProvider', provider);

  if (provider === 'drizzle') {
    // fastify.db инициализируется database-drizzle плагином (зарегистрирован ранее).
    const db = fastify.db;
    if (!db) {
      throw new Error(
        'DB_PROVIDER=drizzle: fastify.db не инициализирован. ' +
          'Проверьте регистрацию database-drizzle плагина и переменную DATABASE_URL.',
      );
    }
    const repos: Repositories = {
      counterparties: new DrizzleCounterpartyRepository(db),
      suppliers: new DrizzleSupplierRepository(db),
      users: new DrizzleUserRepository(db),
      references: new DrizzleReferenceRepository(db),
      notifications: new DrizzleNotificationRepository(db),
      comments: new DrizzleCommentRepository(db),
      notificationActions: new DrizzleNotificationActionRepository(db),
      files: new DrizzleFileRepository(db),
      paymentRequests: new DrizzlePaymentRequestRepository(db),
      contractRequests: new DrizzleContractRequestRepository(db),
      payments: new DrizzlePaymentRepository(db),
      approvals: new DrizzleApprovalRepository(db),
      assignments: new DrizzleAssignmentRepository(db),
      errorLogs: new DrizzleErrorLogRepository(db),
      ocrModels: new DrizzleOcrModelRepository(db),
      rpStage: new DrizzleRpStageRepository(db),
      materials: new DrizzleMaterialRepository(db),
      foundingDocuments: new DrizzleFoundingDocumentRepository(db),
      ocr: new DrizzleOcrRepository(db),
      outbox: new DrizzleOutboxRepository(db),
      auditLog: new DrizzleAuditLogRepository(db),
      jobsLog: new DrizzleJobsLogRepository(db),
    };
    fastify.decorate('repos', repos);
    fastify.log.info({ dbProvider: provider }, 'Repositories registered (Drizzle)');
    return;
  }

  // provider === 'supabase' — fastify.supabase инициализирован databasePlugin-ом.
  const supabase = fastify.supabase;
  if (!supabase) {
    throw new Error(
      'repositoriesPlugin требует databasePlugin зарегистрированным ранее (fastify.supabase).',
    );
  }

  const repos: Repositories = {
    counterparties: new SupabaseCounterpartyRepository(supabase),
    suppliers: new SupabaseSupplierRepository(supabase),
    users: new SupabaseUserRepository(supabase),
    references: new SupabaseReferenceRepository(supabase),
    notifications: new SupabaseNotificationRepository(supabase),
    comments: new SupabaseCommentRepository(supabase),
    notificationActions: new SupabaseNotificationActionRepository(supabase),
    files: new SupabaseFileRepository(supabase),
    paymentRequests: new SupabasePaymentRequestRepository(supabase),
    contractRequests: new SupabaseContractRequestRepository(supabase),
    payments: new SupabasePaymentRepository(supabase),
    approvals: new SupabaseApprovalRepository(supabase),
    assignments: new SupabaseAssignmentRepository(supabase),
    errorLogs: new SupabaseErrorLogRepository(supabase),
    ocrModels: new SupabaseOcrModelRepository(supabase),
    rpStage: new SupabaseRpStageRepository(supabase),
    materials: new SupabaseMaterialRepository(supabase),
    foundingDocuments: new SupabaseFoundingDocumentRepository(supabase),
    ocr: new SupabaseOcrRepository(supabase),
    outbox: new SupabaseOutboxRepository(supabase),
    auditLog: new SupabaseAuditLogRepository(supabase),
    jobsLog: new SupabaseJobsLogRepository(supabase),
  };

  fastify.decorate('repos', repos);

  fastify.log.info({ dbProvider: provider }, 'Repositories registered (Supabase)');
}

export default fp(repositoriesPlugin, {
  name: 'repositories',
  // 'database' (Supabase-клиент) больше не жёсткая зависимость: в standalone+drizzle он не
  // регистрируется. Порядок для supabase-режима сохраняется порядком register() в app.ts.
  dependencies: ['database-drizzle'],
});
