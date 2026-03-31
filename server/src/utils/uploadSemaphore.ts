/** Максимальное количество одновременных загрузок чанков */
const MAX_CONCURRENT_UPLOADS = 100;

/** Текущее количество активных загрузок */
let activeCount = 0;

/**
 * Пытается занять слот для загрузки.
 * Возвращает true, если слот получен, false — если лимит исчерпан.
 */
export function acquireUploadSlot(): boolean {
  if (activeCount >= MAX_CONCURRENT_UPLOADS) {
    return false;
  }
  activeCount++;
  return true;
}

/** Освобождает слот загрузки */
export function releaseUploadSlot(): void {
  if (activeCount > 0) {
    activeCount--;
  }
}

/** Текущее количество активных загрузок (для мониторинга) */
export function getActiveUploadCount(): number {
  return activeCount;
}
