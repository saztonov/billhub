/**
 * Настройка «Автосоздание РП» — при согласовании заявки на этапе «РП» (stage 4) в реестре
 * автоматически создаётся РП, а письмо PayHub со всеми файлами ставится в очередь синхронизации.
 * Хранится в key-value таблице settings (как отправитель РП), меняется администратором на вкладке
 * PayHub. Строка отсутствует или значение повреждено — автосоздание включено.
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema/index.js';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';

/** Ключ настройки в таблице settings */
export const RP_AUTO_CREATE_SETTING_KEY = 'payhub_rp_auto_create';

type DbOrTx = BillhubDatabase | Parameters<Parameters<BillhubDatabase['transaction']>[0]>[0];

/** Разбор значения настройки { enabled }; повреждённое значение — включено. */
export function parseRpAutoCreate(value: unknown): boolean {
  if (value && typeof value === 'object') {
    const enabled = (value as Record<string, unknown>).enabled;
    if (typeof enabled === 'boolean') return enabled;
  }
  return true;
}

/** Включено ли автосоздание РП (читается и внутри транзакции согласования). */
export async function getRpAutoCreateEnabled(db: DbOrTx): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RP_AUTO_CREATE_SETTING_KEY))
    .limit(1);
  return parseRpAutoCreate(row?.value);
}

/** Сохраняет признак автосоздания РП. */
export async function setRpAutoCreateEnabled(db: BillhubDatabase, enabled: boolean): Promise<void> {
  const value = { enabled };
  const updatedAt = new Date().toISOString();
  await db
    .insert(settings)
    .values({ key: RP_AUTO_CREATE_SETTING_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });
}
