/**
 * Ф3 — checkpoint/resume состояния импорта (JSON-файл).
 *
 * Импорт идемпотентен (partialImport SKIP + onConflictDoNothing на линках), поэтому checkpoint —
 * ОПТИМИЗАЦИЯ «не пересканировать», а не корректность: потеря файла → повторный проход, SKIP отработает.
 * Курсор — по `users.id` (обход упорядочен по id). В том же файле — накопленные mismatch (для ревью и
 * approved-mapping) и счётчики. Гонять с стабильного ops-хоста; бэкапить файл.
 */
import { readFile, writeFile } from 'node:fs/promises';
import type { Checkpoint, MigrationState } from './types-state.js';

export class FileCheckpoint implements Checkpoint {
  constructor(private readonly path: string) {}

  async load(): Promise<MigrationState | null> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return JSON.parse(raw) as MigrationState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(state: MigrationState): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}
