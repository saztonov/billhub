import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Проверка: отклонён ли поставщик службой безопасности.
 * Источник истины — денормализованное поле suppliers.last_security_status
 * (заполняется при решении СБ, backfill в миграции 006).
 * Ожидающая повторная проверка не снимает блокировку до нового решения СБ.
 */
export async function isSupplierSbRejected(
  supabase: SupabaseClient,
  supplierId: string | null | undefined,
): Promise<boolean> {
  if (!supplierId) return false;
  const { data } = await supabase
    .from('suppliers')
    .select('last_security_status')
    .eq('id', supplierId)
    .single();
  return (data?.last_security_status as string | null) === 'rejected';
}
