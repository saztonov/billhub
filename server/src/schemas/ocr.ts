/**
 * zod-схемы тел запросов для OCR (ocr). Префикс ocr*, чтобы не конфликтовать с ocr-model.ts.
 */
import { z } from 'zod';

export const ocrAutoEnabledBodySchema = z.object({ enabled: z.boolean() });
export type OcrAutoEnabledBody = z.infer<typeof ocrAutoEnabledBodySchema>;

export const ocrActiveModelBodySchema = z.object({ modelId: z.string() });
export type OcrActiveModelBody = z.infer<typeof ocrActiveModelBodySchema>;

/** Тарифная модель OCR (хранится в settings.ocr_models.models[]). */
export const ocrPricingModelBodySchema = z.object({
  id: z.string(),
  name: z.string(),
  inputPrice: z.number(),
  outputPrice: z.number(),
});
export type OcrPricingModelBody = z.infer<typeof ocrPricingModelBodySchema>;

/** Частичное обновление тарифной модели. */
export const ocrUpdatePricingModelBodySchema = z.record(z.string(), z.unknown());
export type OcrUpdatePricingModelBody = z.infer<typeof ocrUpdatePricingModelBodySchema>;
