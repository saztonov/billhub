/** Ф3 — тип состояния checkpoint и порт хранилища (отдельно от доменных типов). */

export interface StateCounters {
  processed: number;
  importedAdded: number;
  importedSkippedExisting: number;
  linked: number;
  active: number;
  pending: number;
  backfilled: number;
  nullPassword: number;
  errors: number;
}

export interface MigrationState {
  version: 1;
  /** Последний успешно обработанный users.id (курсор resume). */
  cursor: string | null;
  counters: StateCounters;
  /** Несовпадения sub≠users.id (для ревью и approved-mapping). */
  mismatches: { userId: string; kcSub: string; email: string }[];
  startedAt?: string;
  updatedAt?: string;
}

export interface Checkpoint {
  load(): Promise<MigrationState | null>;
  save(state: MigrationState): Promise<void>;
}

export function emptyCounters(): StateCounters {
  return {
    processed: 0,
    importedAdded: 0,
    importedSkippedExisting: 0,
    linked: 0,
    active: 0,
    pending: 0,
    backfilled: 0,
    nullPassword: 0,
    errors: 0,
  };
}
