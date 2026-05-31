/**
 * DrizzleOcrRepository (БД-часть OCR, Iteration 5). settings-upsert → onConflictDoUpdate;
 * read-modify-write моделей и settings-записи — в транзакции. Очередь/OpenRouter/SSE — в роуте.
 */
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  settings,
  statuses,
  paymentRequests,
  counterparties,
  constructionSites,
  recognizedMaterials,
  ocrRecognitionLog,
} from '../../db/schema/index.js';
import type { OcrRepository, OcrSettings, OcrTokenStat, Row } from '../ocr.repository.js';
import type { OcrPricingModelBody } from '../../schemas/ocr.js';

type Db = PostgresJsDatabase<typeof schema>;
type AnyTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DrizzleOcrRepository implements OcrRepository {
  constructor(private readonly db: Db) {}

  async paymentRequestExists(paymentRequestId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, paymentRequestId))
      .limit(1);
    return !!row;
  }

  async getSettings(): Promise<OcrSettings> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ['ocr_auto_enabled', 'ocr_active_model_id', 'ocr_models']));

    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;

    const autoVal = map['ocr_auto_enabled'] as { enabled?: boolean } | undefined;
    const modelVal = map['ocr_active_model_id'] as { modelId?: string } | undefined;
    const modelsVal = map['ocr_models'] as { models?: unknown[] } | undefined;

    return {
      autoEnabled: autoVal?.enabled ?? false,
      activeModelId: modelVal?.modelId ?? '',
      models: modelsVal?.models ?? [],
    };
  }

  private async upsertSetting(tx: AnyTx, key: string, value: unknown): Promise<void> {
    await tx
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async setAutoEnabled(enabled: boolean): Promise<void> {
    await this.db.transaction((tx) => this.upsertSetting(tx, 'ocr_auto_enabled', { enabled }));
  }

  async setActiveModel(modelId: string): Promise<void> {
    await this.db.transaction((tx) => this.upsertSetting(tx, 'ocr_active_model_id', { modelId }));
  }

  private async readModels(tx: AnyTx): Promise<Record<string, unknown>[]> {
    const [row] = await tx
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'ocr_models'))
      .limit(1);
    return ((row?.value as { models?: Record<string, unknown>[] } | null)?.models ?? []) as Record<
      string,
      unknown
    >[];
  }

  async addModel(model: OcrPricingModelBody): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.readModels(tx);
      await this.upsertSetting(tx, 'ocr_models', { models: [...current, model] });
    });
  }

  async updateModel(id: string, partial: Record<string, unknown>): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.readModels(tx);
      await this.upsertSetting(tx, 'ocr_models', {
        models: current.map((m) => (m.id === id ? { ...m, ...partial } : m)),
      });
    });
  }

  async deleteModel(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.readModels(tx);
      await this.upsertSetting(tx, 'ocr_models', {
        models: current.filter((m) => m.id !== id),
      });
    });
  }

  async listApprovedRequests(): Promise<Row[]> {
    const [st] = await this.db
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.entityType, 'payment_request'), eq(statuses.code, 'approved')))
      .limit(1);
    if (!st) return [];

    const requests = await this.db
      .select({
        id: paymentRequests.id,
        requestNumber: paymentRequests.requestNumber,
        invoiceAmount: paymentRequests.invoiceAmount,
        counterpartyName: counterparties.name,
        siteName: constructionSites.name,
      })
      .from(paymentRequests)
      .leftJoin(counterparties, eq(counterparties.id, paymentRequests.counterpartyId))
      .leftJoin(constructionSites, eq(constructionSites.id, paymentRequests.siteId))
      .where(and(eq(paymentRequests.statusId, st.id), eq(paymentRequests.isDeleted, false)))
      .orderBy(desc(paymentRequests.createdAt));

    const prIds = requests.map((r) => r.id);
    let recognizedSet = new Set<string>();
    if (prIds.length > 0) {
      const mat = await this.db
        .select({ prId: recognizedMaterials.paymentRequestId })
        .from(recognizedMaterials)
        .where(inArray(recognizedMaterials.paymentRequestId, prIds));
      recognizedSet = new Set(mat.map((r) => r.prId));
    }

    return requests.map((row) => ({
      id: row.id,
      requestNumber: row.requestNumber,
      counterpartyName: row.counterpartyName ?? '',
      siteName: row.siteName ?? '',
      invoiceAmount: row.invoiceAmount ?? null,
      recognized: recognizedSet.has(row.id),
    }));
  }

  async listLogs(page: number, pageSize: number): Promise<{ logs: Row[]; total: number }> {
    const from = (page - 1) * pageSize;

    const [c] = await this.db.select({ c: count() }).from(ocrRecognitionLog);

    const data = await this.db
      .select({
        id: ocrRecognitionLog.id,
        paymentRequestId: ocrRecognitionLog.paymentRequestId,
        fileId: ocrRecognitionLog.fileId,
        modelId: ocrRecognitionLog.modelId,
        status: ocrRecognitionLog.status,
        errorMessage: ocrRecognitionLog.errorMessage,
        attemptNumber: ocrRecognitionLog.attemptNumber,
        inputTokens: ocrRecognitionLog.inputTokens,
        outputTokens: ocrRecognitionLog.outputTokens,
        totalCost: ocrRecognitionLog.totalCost,
        startedAt: ocrRecognitionLog.startedAt,
        completedAt: ocrRecognitionLog.completedAt,
      })
      .from(ocrRecognitionLog)
      .orderBy(desc(ocrRecognitionLog.startedAt))
      .limit(pageSize)
      .offset(from);

    const prIds = [...new Set(data.map((r) => r.paymentRequestId))];
    const prMap: Record<string, string> = {};
    if (prIds.length > 0) {
      const prData = await this.db
        .select({ id: paymentRequests.id, requestNumber: paymentRequests.requestNumber })
        .from(paymentRequests)
        .where(inArray(paymentRequests.id, prIds));
      for (const r of prData) prMap[r.id] = r.requestNumber;
    }

    const logs = data.map((row) => ({
      id: row.id,
      paymentRequestId: row.paymentRequestId,
      requestNumber: prMap[row.paymentRequestId] ?? '',
      fileId: row.fileId,
      modelId: row.modelId,
      status: row.status,
      errorMessage: row.errorMessage,
      attemptNumber: row.attemptNumber,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalCost: row.totalCost,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    }));

    return { logs, total: Number(c?.c ?? 0) };
  }

  async getTokenStats(): Promise<Record<string, OcrTokenStat>> {
    const data = await this.db
      .select({
        modelId: ocrRecognitionLog.modelId,
        inputTokens: ocrRecognitionLog.inputTokens,
        outputTokens: ocrRecognitionLog.outputTokens,
        totalCost: ocrRecognitionLog.totalCost,
      })
      .from(ocrRecognitionLog)
      .where(eq(ocrRecognitionLog.status, 'success'));

    const stats: Record<string, OcrTokenStat> = {};
    for (const r of data) {
      const modelId = r.modelId;
      if (!stats[modelId]) stats[modelId] = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
      const entry = stats[modelId]!;
      entry.inputTokens += Number(r.inputTokens ?? 0);
      entry.outputTokens += Number(r.outputTokens ?? 0);
      entry.totalCost += Number(r.totalCost ?? 0);
    }
    return stats;
  }
}
