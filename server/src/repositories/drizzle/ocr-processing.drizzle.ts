/**
 * OcrProcessingRepository — write-часть OCR-пайплайна (Этап 1, VPS2, standalone на Yandex PG).
 *
 * Отделён от DrizzleOcrRepository (ocr.drizzle.ts — read/admin: настройки, логи, статистика).
 * Здесь операции, которые выполняет распознавание счетов в воркере: чтение настроек и файлов-счетов,
 * запись в ocr_recognition_log, materials_dictionary, recognized_materials. Используется ocrService
 * вместо прямого Supabase-клиента (createClient), поэтому OCR работает на Yandex PG без Supabase.
 *
 * numeric-колонки (quantity/price/amount/total_cost) в Drizzle — строковый режим: числа
 * конвертируются в строку при вставке (numStr).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  settings,
  paymentRequestFiles,
  materialsDictionary,
  recognizedMaterials,
  ocrRecognitionLog,
} from '../../db/schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

/** Модель OCR из настроек (settings.ocr_models). */
export interface OcrModelSetting {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
}

export interface OcrSettingsResult {
  autoEnabled: boolean;
  activeModelId: string;
  models: OcrModelSetting[];
}

export interface OcrInvoiceFile {
  id: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
}

export interface RecognitionLogInsert {
  paymentRequestId: string;
  fileId: string;
  modelId: string;
  status: string;
  attemptNumber?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalCost?: number | null;
  completedAt?: string | null;
}

export interface RecognitionLogPatch {
  status: string;
  errorMessage?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalCost?: number | null;
  completedAt?: string | null;
}

export interface RecognizedMaterialInsert {
  paymentRequestId: string;
  fileId: string;
  materialId: string;
  pageNumber: number | null;
  position: number;
  article: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}

/** number → string для numeric-колонок Drizzle; null/undefined → null. */
function numStr(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

export class OcrProcessingRepository {
  constructor(private readonly db: Db) {}

  /** Настройки OCR (ocr_auto_enabled / ocr_active_model_id / ocr_models). */
  async getSettings(): Promise<OcrSettingsResult> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models']));

    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;

    const autoVal = map['ocr_auto_enabled'] as { enabled?: boolean } | undefined;
    const modelVal = map['ocr_active_model_id'] as { modelId?: string } | undefined;
    const modelsVal = map['ocr_models'] as { models?: OcrModelSetting[] } | undefined;

    return {
      autoEnabled: autoVal?.enabled ?? false,
      activeModelId: modelVal?.modelId ?? '',
      models: modelsVal?.models ?? [],
    };
  }

  /** Файлы-счета заявки (не отклонённые) заданного типа документа. */
  async getInvoiceFiles(paymentRequestId: string, docTypeId: string): Promise<OcrInvoiceFile[]> {
    const rows = await this.db
      .select({
        id: paymentRequestFiles.id,
        fileKey: paymentRequestFiles.fileKey,
        fileName: paymentRequestFiles.fileName,
        mimeType: paymentRequestFiles.mimeType,
      })
      .from(paymentRequestFiles)
      .where(
        and(
          eq(paymentRequestFiles.paymentRequestId, paymentRequestId),
          eq(paymentRequestFiles.documentTypeId, docTypeId),
          eq(paymentRequestFiles.isRejected, false),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      fileKey: r.fileKey,
      fileName: r.fileName,
      mimeType: r.mimeType ?? '',
    }));
  }

  /** Удаляет ранее распознанные материалы заявки (перед новым распознаванием). */
  async deleteRecognizedMaterials(paymentRequestId: string): Promise<void> {
    await this.db
      .delete(recognizedMaterials)
      .where(eq(recognizedMaterials.paymentRequestId, paymentRequestId));
  }

  /** Вставляет запись лога распознавания, возвращает её id. */
  async insertRecognitionLog(entry: RecognitionLogInsert): Promise<string> {
    const [row] = await this.db
      .insert(ocrRecognitionLog)
      .values({
        paymentRequestId: entry.paymentRequestId,
        fileId: entry.fileId,
        modelId: entry.modelId,
        status: entry.status,
        attemptNumber: entry.attemptNumber ?? 1,
        inputTokens: entry.inputTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        totalCost: numStr(entry.totalCost),
        completedAt: entry.completedAt ?? null,
      })
      .returning({ id: ocrRecognitionLog.id });
    return row!.id;
  }

  /** Обновляет запись лога распознавания по id (success/error). */
  async updateRecognitionLog(id: string, patch: RecognitionLogPatch): Promise<void> {
    await this.db
      .update(ocrRecognitionLog)
      .set({
        status: patch.status,
        errorMessage: patch.errorMessage ?? null,
        inputTokens: patch.inputTokens ?? null,
        outputTokens: patch.outputTokens ?? null,
        totalCost: numStr(patch.totalCost),
        completedAt: patch.completedAt ?? null,
      })
      .where(eq(ocrRecognitionLog.id, id));
  }

  /** Ищет материал в справочнике по name(+unit); создаёт при отсутствии. Возвращает id. */
  async findOrCreateMaterial(name: string, unit: string | null): Promise<string> {
    const whereClause = unit
      ? and(eq(materialsDictionary.name, name), eq(materialsDictionary.unit, unit))
      : and(eq(materialsDictionary.name, name), isNull(materialsDictionary.unit));

    const [existing] = await this.db
      .select({ id: materialsDictionary.id })
      .from(materialsDictionary)
      .where(whereClause)
      .limit(1);
    if (existing) return existing.id;

    try {
      const [created] = await this.db
        .insert(materialsDictionary)
        .values({ name, unit: unit ?? null })
        .returning({ id: materialsDictionary.id });
      return created!.id;
    } catch (err) {
      // Возможна гонка при параллельном распознавании — повторный поиск.
      const [retry] = await this.db
        .select({ id: materialsDictionary.id })
        .from(materialsDictionary)
        .where(whereClause)
        .limit(1);
      if (retry) return retry.id;
      throw err;
    }
  }

  /** Вставляет распознанную позицию (recognized_materials). */
  async insertRecognizedMaterial(row: RecognizedMaterialInsert): Promise<void> {
    await this.db.insert(recognizedMaterials).values({
      paymentRequestId: row.paymentRequestId,
      fileId: row.fileId,
      materialId: row.materialId,
      pageNumber: row.pageNumber,
      position: row.position,
      article: row.article,
      quantity: numStr(row.quantity),
      price: numStr(row.price),
      amount: numStr(row.amount),
    });
  }
}
