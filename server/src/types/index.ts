import type { SupabaseClient } from '@supabase/supabase-js';
import type { S3Client } from '@aws-sdk/client-s3';
import type IORedis from 'ioredis';
import type { PayHubClient } from '../services/payhub/payhub-client.js';

/** Роли пользователей системы */
export type UserRole = 'admin' | 'user' | 'counterparty_user' | 'security';

/** Профиль пользователя, прикрепляемый к запросу после аутентификации */
export interface RequestUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  counterpartyId?: string;
  department?: string;
  allSites: boolean;
  isActive: boolean;
}

/** Расширение типов Fastify */
declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser;
    /** Unix timestamp (секунды) истечения access_token — заполняется в authenticate */
    accessTokenExp?: number;
  }

  interface FastifyInstance {
    supabase: SupabaseClient;
    s3Client: S3Client;
    s3Bucket: string;
    redis: IORedis.default;
    /** Клиент внешнего API PayHub; null — интеграция не настроена */
    payhub: PayHubClient | null;
  }
}
