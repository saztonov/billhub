/**
 * DrizzleOcrModelRepository (Iteration 5). OCR-модели; мутации — в транзакции.
 * Реальная колонка — `name` (исходный роут ошибочно использовал `model_name`).
 */
import { desc, eq, getTableColumns } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { ocrModels } from '../../db/schema/index.js';
import type { OcrModelRepository, Row } from '../ocr-model.repository.js';
import type { OcrModelBody } from '../../schemas/ocr-model.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleOcrModelRepository implements OcrModelRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Row[]> {
    return (await this.db
      .select(getTableColumns(ocrModels))
      .from(ocrModels)
      .orderBy(desc(ocrModels.createdAt))) as Row[];
  }

  async create(input: OcrModelBody): Promise<Row> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(ocrModels)
        .values({
          modelId: input.modelId,
          name: input.name,
          isActive: input.isActive ?? false,
        })
        .returning(getTableColumns(ocrModels));
      return created as Row;
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(ocrModels).where(eq(ocrModels.id, id));
    });
  }

  async setActive(id: string): Promise<Row> {
    return this.db.transaction(async (tx) => {
      // Снимаем активность со всех моделей (как .neq('id','') в Supabase — затрагивает все строки).
      await tx.update(ocrModels).set({ isActive: false });
      const [activated] = await tx
        .update(ocrModels)
        .set({ isActive: true })
        .where(eq(ocrModels.id, id))
        .returning(getTableColumns(ocrModels));
      return activated as Row;
    });
  }
}
