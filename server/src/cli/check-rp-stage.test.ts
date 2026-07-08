/**
 * Unit-тесты чистой оценки evaluateRpStageChecks (без БД).
 * Сбор состояния (collectRpStageState) — read-only SQL, проверяется на VPS/CI.
 */
import { describe, it, expect } from 'vitest';
import { evaluateRpStageChecks, type RpStageRawState } from './check-rp-stage.js';

const GREEN: RpStageRawState = {
  enumHasRp: true,
  tableExists: true,
  assigneesCount: 4,
  statusRpExists: true,
  statusLegacyExists: false,
  legacyPendingCount: 0,
  pendingRpWrongStageNumbers: [],
  statusRpWithoutPendingNumbers: [],
  stage3WithoutPendingNumbers: [],
};

describe('evaluateRpStageChecks', () => {
  it('зелёное состояние — все проверки ok', () => {
    const checks = evaluateRpStageChecks(GREEN);
    expect(checks).toHaveLength(8);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.key === 'table')!.detail).toContain('4');
  });

  it('неконвертированные pending и залипшие заявки — соответствующие проверки падают', () => {
    const checks = evaluateRpStageChecks({
      ...GREEN,
      legacyPendingCount: 2,
      pendingRpWrongStageNumbers: ['713'],
      statusRpWithoutPendingNumbers: ['803'],
    });
    const byKey = new Map(checks.map((c) => [c.key, c]));
    expect(byKey.get('legacy_pending')!.ok).toBe(false);
    expect(byKey.get('pending_rp_stage')!.ok).toBe(false);
    expect(byKey.get('pending_rp_stage')!.detail).toContain('713');
    expect(byKey.get('status_without_pending')!.ok).toBe(false);
    expect(byKey.get('status_without_pending')!.detail).toContain('803');
    // Остальные проверки не задеты
    expect(byKey.get('enum_rp')!.ok).toBe(true);
    expect(byKey.get('stage3_without_pending')!.ok).toBe(true);
  });

  it('отсутствие enum/таблицы/статуса — красные проверки', () => {
    const checks = evaluateRpStageChecks({
      ...GREEN,
      enumHasRp: false,
      tableExists: false,
      assigneesCount: 0,
      statusRpExists: false,
      statusLegacyExists: true,
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.key);
    expect(failed.sort()).toEqual(['enum_rp', 'status_legacy', 'status_rp', 'table'].sort());
  });
});
