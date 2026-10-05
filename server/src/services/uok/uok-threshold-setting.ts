/**
 * Настройка «Порог этапа УОК» — сумма счёта, строго свыше которой заявка на оплату после
 * согласования ОМТС уходит на этап «УОК». Хранится в key-value таблице settings (как отправитель
 * РП), меняется администратором (Настройки заявок -> УОК). Строка отсутствует или значение
 * повреждено — действует порог по умолчанию (как в миграции 0022).
 */
import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema/index.js';
import type { BillhubDatabase } from '../../plugins/database-drizzle.js';

/** Ключ настройки в таблице settings */
export const UOK_THRESHOLD_SETTING_KEY = 'uok_amount_threshold';

/** Порог по умолчанию, ₽ */
export const DEFAULT_UOK_THRESHOLD = 400_000;

type DbOrTx = BillhubDatabase | Parameters<Parameters<BillhubDatabase['transaction']>[0]>[0];

/** Разбор значения настройки { amount }; повреждённое значение — порог по умолчанию. */
export function parseUokThreshold(value: unknown): number {
  if (value && typeof value === 'object') {
    const amount = (value as Record<string, unknown>).amount;
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) return amount;
  }
  return DEFAULT_UOK_THRESHOLD;
}

/** Текущий порог этапа УОК (читается и внутри транзакции согласования). */
export async function getUokThreshold(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, UOK_THRESHOLD_SETTING_KEY))
    .limit(1);
  return parseUokThreshold(row?.value);
}

/** Сохраняет порог этапа УОК. */
export async function setUokThreshold(db: BillhubDatabase, amount: number): Promise<void> {
  const value = { amount };
  const updatedAt = new Date().toISOString();
  await db
    .insert(settings)
    .values({ key: UOK_THRESHOLD_SETTING_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });
}

/**
 * Требуется ли заявке этап УОК: сумма счёта строго больше порога. Сумма не указана —
 * этап требуется (консервативно: крупную заявку без суммы не пропускаем мимо УОК).
 */
export function requiresUokStage(
  invoiceAmount: number | null | undefined,
  threshold: number,
): boolean {
  if (invoiceAmount == null) return true;
  return invoiceAmount > threshold;
}
