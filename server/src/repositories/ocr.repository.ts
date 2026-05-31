/**
 * Repository-интерфейс домена «ocr» (БД-часть). Очередь BullMQ, OpenRouter и SSE — в роуте.
 */
import type { OcrPricingModelBody } from '../schemas/ocr.js';

export type Row = Record<string, unknown>;

export interface OcrSettings {
  autoEnabled: boolean;
  activeModelId: string;
  models: unknown[];
}

export interface OcrTokenStat {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export interface OcrRepository {
  /** Существует ли заявка (для постановки в очередь). */
  paymentRequestExists(paymentRequestId: string): Promise<boolean>;
  /** Настройки OCR (auto/active-model/models из settings). */
  getSettings(): Promise<OcrSettings>;
  setAutoEnabled(enabled: boolean): Promise<void>;
  setActiveModel(modelId: string): Promise<void>;
  /** Тарифные модели в settings.ocr_models.models[] (read-modify-write). */
  addModel(model: OcrPricingModelBody): Promise<void>;
  updateModel(id: string, partial: Record<string, unknown>): Promise<void>;
  deleteModel(id: string): Promise<void>;
  /** Согласованные заявки для ручного OCR (+флаг recognized). */
  listApprovedRequests(): Promise<Row[]>;
  /** Логи распознавания с пагинацией (+номера заявок). */
  listLogs(page: number, pageSize: number): Promise<{ logs: Row[]; total: number }>;
  /** Статистика токенов по моделям (status='success'). */
  getTokenStats(): Promise<Record<string, OcrTokenStat>>;
}
