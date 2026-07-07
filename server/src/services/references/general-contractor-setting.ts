/**
 * Настройка «Генподрядчик» — контрагент, от имени которого создаются заявки типа
 * «Своя закупка» (own_purchase). Всегда СУ-10 (ИНН 7736255508). Выбирается администратором
 * в справочнике подрядчиков, хранится в key-value таблице settings (как настройка отправителя РП).
 * Читается роутом создания заявки (own_purchase) и модалкой создания на фронте.
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema/index.js';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';

/** Ключ настройки в таблице settings */
export const GENERAL_CONTRACTOR_SETTING_KEY = 'general_contractor';

/** Канонический ИНН генподрядчика (СУ-10) — жёсткая гарантия «контрагент всегда СУ-10». */
export const GENERAL_CONTRACTOR_INN = '7736255508';

/** Генподрядчик: ID контрагента справочника + снимок для отображения */
export interface GeneralContractorSetting {
  counterpartyId: string;
  name: string | null;
  inn: string | null;
}

/** Разбор значения настройки; повреждённое/чужое значение трактуется как «не задано». */
function parseSetting(value: unknown): GeneralContractorSetting | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.counterpartyId !== 'string' || rec.counterpartyId.length === 0) return null;
  return {
    counterpartyId: rec.counterpartyId,
    name: typeof rec.name === 'string' ? rec.name : null,
    inn: typeof rec.inn === 'string' ? rec.inn : null,
  };
}

/** Возвращает настроенного генподрядчика или null (не настроен). */
export async function getGeneralContractorSetting(
  db: BillhubDatabase,
): Promise<GeneralContractorSetting | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, GENERAL_CONTRACTOR_SETTING_KEY))
    .limit(1);
  return parseSetting(row?.value);
}

/** Сохраняет генподрядчика; null — очищает настройку. */
export async function setGeneralContractorSetting(
  db: BillhubDatabase,
  contractor: GeneralContractorSetting | null,
): Promise<void> {
  if (contractor === null) {
    await db.delete(settings).where(eq(settings.key, GENERAL_CONTRACTOR_SETTING_KEY));
    return;
  }
  const value = {
    counterpartyId: contractor.counterpartyId,
    name: contractor.name,
    inn: contractor.inn,
  };
  await db
    .insert(settings)
    .values({ key: GENERAL_CONTRACTOR_SETTING_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
