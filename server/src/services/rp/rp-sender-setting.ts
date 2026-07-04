/**
 * Настройка «Отправитель РП» — контрагент PayHub, от имени которого создаются
 * распределительные письма. Выбирается администратором один раз (вкладка PayHub
 * в администрировании), хранится в key-value таблице settings (как настройки OCR).
 * Читается API-роутами и BullMQ-воркером синхронизации писем.
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema/index.js';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';

/** Ключ настройки в таблице settings */
export const RP_SENDER_SETTING_KEY = 'payhub_rp_sender';

/** Контрагент-отправитель РП: канонический ID PayHub + снимок для отображения */
export interface RpSenderSetting {
  /** ID контрагента PayHub (catalog/contractors), строкой для устойчивости */
  contractorId: string;
  name: string | null;
  inn: string | null;
}

/** Разбор значения настройки; повреждённое/чужое значение трактуется как «не задано». */
function parseSetting(value: unknown): RpSenderSetting | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.contractorId !== 'string' || rec.contractorId.length === 0) return null;
  return {
    contractorId: rec.contractorId,
    name: typeof rec.name === 'string' ? rec.name : null,
    inn: typeof rec.inn === 'string' ? rec.inn : null,
  };
}

/** Возвращает настроенного отправителя РП или null (не настроен). */
export async function getRpSenderSetting(db: BillhubDatabase): Promise<RpSenderSetting | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RP_SENDER_SETTING_KEY))
    .limit(1);
  return parseSetting(row?.value);
}

/** Сохраняет отправителя РП; null — очищает настройку. */
export async function setRpSenderSetting(
  db: BillhubDatabase,
  sender: RpSenderSetting | null,
): Promise<void> {
  if (sender === null) {
    await db.delete(settings).where(eq(settings.key, RP_SENDER_SETTING_KEY));
    return;
  }
  const value = { contractorId: sender.contractorId, name: sender.name, inn: sender.inn };
  await db
    .insert(settings)
    .values({ key: RP_SENDER_SETTING_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
