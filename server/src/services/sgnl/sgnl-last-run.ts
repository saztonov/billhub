/**
 * Итог последнего прогона выгрузки в SIGNAL — в key-value таблице settings
 * (как настройки OCR и отправитель РП). Пишет worker, читает вкладка админки.
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema/index.js';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';
import type { SgnlSyncReport } from './sgnl-sync-types.js';

export const SGNL_LAST_RUN_SETTING_KEY = 'sgnl_last_run';

export async function getSgnlLastRun(db: BillhubDatabase): Promise<SgnlSyncReport | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SGNL_LAST_RUN_SETTING_KEY))
    .limit(1);
  const value = row?.value as SgnlSyncReport | undefined;
  return value && typeof value === 'object' && typeof value.startedAt === 'string' ? value : null;
}

export async function setSgnlLastRun(db: BillhubDatabase, report: SgnlSyncReport): Promise<void> {
  const value = report as unknown as Record<string, unknown>;
  await db
    .insert(settings)
    .values({ key: SGNL_LAST_RUN_SETTING_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
