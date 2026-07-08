/**
 * SupabaseRpStageRepository — заглушка для компиляции (принцип 2: supabase — замороженный
 * rollback-путь на старый прод). Этап «РП» drizzle-only: в legacy-БД нет ни таблицы
 * rp_stage_assignees, ни enum-значения 'rp' (миграции 0015/0016 не применяются к Supabase).
 * Read-методы возвращают безопасную пустоту (гейты просто не пропускают), write — ошибку.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RpStageRepository,
  RpStageAssignee,
  RpStageCandidate,
} from '../rp-stage.repository.js';

const NOT_SUPPORTED = 'Этап «РП» не поддерживается в supabase-режиме (legacy rollback)';

export class SupabaseRpStageRepository implements RpStageRepository {
  constructor(private readonly supabase: SupabaseClient) {
    void this.supabase;
  }

  async listAssignees(): Promise<RpStageAssignee[]> {
    return [];
  }

  async addAssignee(): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }

  async removeAssignee(): Promise<void> {
    throw new Error(NOT_SUPPORTED);
  }

  async listCandidates(): Promise<RpStageCandidate[]> {
    return [];
  }

  async getAssigneeSiteIds(): Promise<string[]> {
    return [];
  }
}
