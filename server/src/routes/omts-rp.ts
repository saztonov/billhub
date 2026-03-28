import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

/* ------------------------------------------------------------------ */
/*  Плагин маршрутов настроек ОМТС РП                                  */
/* ------------------------------------------------------------------ */

async function omtsRpRoutes(fastify: FastifyInstance): Promise<void> {
  const adminOnly = { preHandler: [authenticate, requireRole('admin')] };

  /* ---------- GET /api/omts-rp/sites ---------- */
  fastify.get('/api/omts-rp/sites', adminOnly, async (_request, reply) => {
    const supabase = fastify.supabase;

    // Читаем массив site_ids из settings
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_sites')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    const siteIds = ((data.value as Record<string, unknown>).site_ids as string[]) ?? [];

    if (siteIds.length === 0) {
      return reply.send({ data: [] });
    }

    // Подгружаем имена объектов
    const { data: sitesData, error: sitesErr } = await supabase
      .from('construction_sites')
      .select('id, name')
      .in('id', siteIds);
    if (sitesErr) return reply.status(500).send({ error: sitesErr.message });

    return reply.send({ data: sitesData ?? [] });
  });

  /* ---------- PUT /api/omts-rp/sites ---------- */
  fastify.put('/api/omts-rp/sites', adminOnly, async (request, reply) => {
    const body = request.body as { action: 'add' | 'remove'; siteId: string };
    const supabase = fastify.supabase;

    // Читаем текущий массив
    const { data, error: readErr } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_sites')
      .single();
    if (readErr) return reply.status(500).send({ error: readErr.message });

    const current = ((data.value as Record<string, unknown>).site_ids as string[]) ?? [];
    let updated: string[];

    if (body.action === 'add') {
      if (current.includes(body.siteId)) return reply.send({ success: true });
      updated = [...current, body.siteId];
    } else {
      updated = current.filter((id) => id !== body.siteId);
    }

    const { error } = await supabase
      .from('settings')
      .update({ value: { site_ids: updated }, updated_at: new Date().toISOString() })
      .eq('key', 'omts_rp_sites');
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/omts-rp/responsible ---------- */
  fastify.get('/api/omts-rp/responsible', adminOnly, async (_request, reply) => {
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'omts_rp_config')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    const responsibleUserId = (data.value as Record<string, unknown>).responsible_user_id as string | null;

    return reply.send({ responsibleUserId });
  });

  /* ---------- PUT /api/omts-rp/responsible ---------- */
  fastify.put('/api/omts-rp/responsible', adminOnly, async (request, reply) => {
    const body = request.body as { userId: string | null };
    const supabase = fastify.supabase;

    const { error } = await supabase
      .from('settings')
      .update({
        value: { responsible_user_id: body.userId },
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'omts_rp_config');
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ success: true });
  });

  /* ---------- GET /api/omts-rp/omts-users ---------- */
  fastify.get('/api/omts-rp/omts-users', adminOnly, async (_request, reply) => {
    const supabase = fastify.supabase;

    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('department_id', 'omts')
      .eq('is_active', true)
      .in('role', ['admin', 'user'])
      .order('full_name', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ data: data ?? [] });
  });
}

export default fp(omtsRpRoutes, { name: 'omts-rp-routes' });
