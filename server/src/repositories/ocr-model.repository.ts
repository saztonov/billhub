/**
 * Repository-интерфейс домена «ocr-models» (settings).
 */
import type { OcrModelBody } from '../schemas/ocr-model.js';

export type Row = Record<string, unknown>;

export interface OcrModelRepository {
  /** Список моделей, новые сверху. */
  list(): Promise<Row[]>;
  /** Добавить модель (is_active по умолчанию false), вернуть созданную. */
  create(input: OcrModelBody): Promise<Row>;
  /** Удалить модель по id. */
  delete(id: string): Promise<void>;
  /** Сделать модель активной: снять активность со всех + активировать одну, вернуть её. */
  setActive(id: string): Promise<Row>;
}
