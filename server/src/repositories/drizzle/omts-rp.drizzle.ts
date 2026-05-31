/**
 * DrizzleOmtsRpRepository (Iteration 5). Настройки ОМТС-РП в settings (jsonb);
 * read-modify-write — в транзакции.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { settings, constructionSites } from '../../db/schema/index.js';
import type { OmtsRpRepository, Row } from '../omts-rp.repository.js';

type Db = PostgresJsDatabase<typeof schema>;
const nowIso = () => new Date().toISOString();

export class DrizzleOmtsRpRepository implements OmtsRpRepository {
  constructor(private readonly db: Db) {}

  async getResponsibleUserId(): Promise<string | null> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'omts_rp_config'))
      .limit(1);
    if (!row) return null;
    return ((row.value as Row).responsible_user_id as string | null) ?? null;
  }

  async getSites(): Promise<Row[]> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'omts_rp_sites'))
      .limit(1);
    if (!row) throw new Error('Настройка omts_rp_sites не найдена');

    const siteIds = ((row.value as Row).site_ids as string[]) ?? [];
    if (siteIds.length === 0) return [];

    return (await this.db
      .select({ id: constructionSites.id, name: constructionSites.name })
      .from(constructionSites)
      .where(inArray(constructionSites.id, siteIds))) as Row[];
  }

  async updateSites(action: 'add' | 'remove', siteId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, 'omts_rp_sites'))
        .limit(1);
      if (!row) throw new Error('Настройка omts_rp_sites не найдена');

      const current = ((row.value as Row).site_ids as string[]) ?? [];
      let updated: string[];
      if (action === 'add') {
        if (current.includes(siteId)) return;
        updated = [...current, siteId];
      } else {
        updated = current.filter((id) => id !== siteId);
      }

      await tx
        .update(settings)
        .set({ value: { site_ids: updated }, updatedAt: nowIso() })
        .where(eq(settings.key, 'omts_rp_sites'));
    });
  }

  async setResponsibleUserId(userId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(settings)
        .set({ value: { responsible_user_id: userId }, updatedAt: nowIso() })
        .where(eq(settings.key, 'omts_rp_config'));
    });
  }
}
