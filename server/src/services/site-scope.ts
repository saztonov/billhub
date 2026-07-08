import type { FastifyRequest } from 'fastify';

/** Скоуп объектов пользователя, вычисленный на сервере. */
export interface SiteScope {
  allSites: boolean;
  siteIds: string[];
}

/**
 * Резолвит ограничение по объектам строительства из профиля пользователя,
 * НЕ доверяя клиентским query-параметрам allSites/siteIds: admin и user с
 * all_sites видят все объекты, остальные — только объекты из своего маппинга.
 */
export async function resolveSiteScope(request: FastifyRequest): Promise<SiteScope> {
  const user = request.user!;
  if (user.role === 'admin' || user.allSites) return { allSites: true, siteIds: [] };
  const siteIds = await request.server.repos.paymentRequests.getUserSiteIds(user.id);
  return { allSites: false, siteIds };
}
