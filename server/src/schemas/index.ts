/**
 * Barrel-экспорт всех zod-схем.
 *
 * Импорт в routes/: `import { counterpartySchema } from '@server/schemas';`
 * Использование с Fastify TypeBox-style: see fastify-type-provider-zod.
 */
export * from './common.js';
export * from './counterparty.js';
export * from './supplier.js';
export * from './user.js';
export * from './reference.js';
export * from './notification.js';
export * from './comment.js';
export * from './notification-action.js';
export * from './file.js';
export * from './payment-request.js';
export * from './contract-request.js';
export * from './payment.js';
