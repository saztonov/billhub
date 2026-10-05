import { describe, it, expect } from 'vitest';
import {
  STAGE_OMTS,
  STAGE_RP,
  STAGE_SHTAB,
  STAGE_UOK,
  stageDepartment,
  stageStatusCode,
  userMayActOnStage,
  type DbOrTx,
} from './approval-stage-flow.js';

describe('approval-stage-flow: этапы Штаб → ОМТС → УОК → РП', () => {
  it('номера этапов', () => {
    expect([STAGE_SHTAB, STAGE_OMTS, STAGE_UOK, STAGE_RP]).toEqual([1, 2, 3, 4]);
  });

  it('stageDepartment: департамент этапа, фолбэк — ОМТС', () => {
    expect(stageDepartment(1)).toBe('shtab');
    expect(stageDepartment(2)).toBe('omts');
    expect(stageDepartment(3)).toBe('uok');
    expect(stageDepartment(4)).toBe('rp');
    expect(stageDepartment(99)).toBe('omts');
  });

  it('stageStatusCode: код статуса «на согласовании» этапа', () => {
    expect(stageStatusCode(1)).toBe('approv_shtab');
    expect(stageStatusCode(2)).toBe('approv_omts');
    expect(stageStatusCode(3)).toBe('approv_uok');
    expect(stageStatusCode(4)).toBe('approv_rp');
  });

  it('userMayActOnStage: этап 3 — только подразделение УОК или админ', async () => {
    // Для этапов 1–3 БД не читается.
    const db = {} as DbOrTx;
    const base = { stage: STAGE_UOK, siteId: 's', userId: 'u', isAdmin: false };
    expect(await userMayActOnStage(db, { ...base, userDepartment: 'uok' })).toBe(true);
    expect(await userMayActOnStage(db, { ...base, userDepartment: 'omts' })).toBe(false);
    expect(await userMayActOnStage(db, { ...base, userDepartment: null })).toBe(false);
    expect(await userMayActOnStage(db, { ...base, userDepartment: null, isAdmin: true })).toBe(
      true,
    );
    expect(await userMayActOnStage(db, { ...base, stage: STAGE_OMTS, userDepartment: 'uok' })).toBe(
      false,
    );
  });
});
