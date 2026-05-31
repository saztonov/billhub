/**
 * zod-схемы тел запросов для OCR-моделей (settings/ocr-models).
 * Поле `name` соответствует реальной колонке ocr_models.name (исходный роут ошибочно
 * обращался к несуществующей `model_name`; колонка в БД/schema.sql и тип фронта — `name`).
 */
import { z } from 'zod';

export const ocrModelBodySchema = z.object({
  name: z.string().min(1),
  modelId: z.string().min(1),
  isActive: z.boolean().optional(),
});
export type OcrModelBody = z.infer<typeof ocrModelBodySchema>;

export const ocrModelSetActiveBodySchema = z.object({
  id: z.string().min(1),
});
export type OcrModelSetActiveBody = z.infer<typeof ocrModelSetActiveBodySchema>;
