import fp from 'fastify-plugin';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { FastifyInstance } from 'fastify';

/** Плагин подключения к Supabase */
async function databasePlugin(fastify: FastifyInstance): Promise<void> {
  const supabase = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  fastify.decorate('supabase', supabase);
  fastify.log.info('Supabase клиент инициализирован');
}

export default fp(databasePlugin, {
  name: 'database',
});
