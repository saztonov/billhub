/**
 * SupabaseOcrModelRepository — rollback-провайдер OCR-моделей (Iteration 5).
 * Порт routes/settings.ts. ВАЖНО: используется реальная колонка `name` (исходный роут
 * ошибочно обращался к несуществующей `model_name` — операции падали с 42703).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OcrModelRepository, Row } from '../ocr-model.repository.js';
import type { OcrModelBody } from '../../schemas/ocr-model.js';

const SELECT_FIELDS = 'id, model_id, name, is_active, created_at';

export class SupabaseOcrModelRepository implements OcrModelRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async list(): Promise<Row[]> {
    const { data, error } = await this.supabase
      .from('ocr_models')
      .select(SELECT_FIELDS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(input: OcrModelBody): Promise<Row> {
    const { data, error } = await this.supabase
      .from('ocr_models')
      .insert({
        model_id: input.modelId,
        name: input.name,
        is_active: input.isActive ?? false,
      })
      .select(SELECT_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return data as Row;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('ocr_models').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async setActive(id: string): Promise<Row> {
    // Снимаем активность со всех моделей
    const { error: deactivateError } = await this.supabase
      .from('ocr_models')
      .update({ is_active: false })
      .neq('id', '');
    if (deactivateError) throw new Error(deactivateError.message);

    const { data, error } = await this.supabase
      .from('ocr_models')
      .update({ is_active: true })
      .eq('id', id)
      .select(SELECT_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return data as Row;
  }
}
