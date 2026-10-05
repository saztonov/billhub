import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UOK_THRESHOLD,
  parseUokThreshold,
  requiresUokStage,
} from './uok-threshold-setting.js';

describe('uok-threshold-setting', () => {
  it('parseUokThreshold: корректное значение { amount }', () => {
    expect(parseUokThreshold({ amount: 250_000 })).toBe(250_000);
    expect(parseUokThreshold({ amount: 0 })).toBe(0);
  });

  it('parseUokThreshold: отсутствие/повреждённое значение — порог по умолчанию', () => {
    expect(DEFAULT_UOK_THRESHOLD).toBe(400_000);
    for (const v of [
      undefined,
      null,
      5,
      'x',
      {},
      { amount: '100' },
      { amount: -1 },
      { amount: NaN },
    ]) {
      expect(parseUokThreshold(v)).toBe(DEFAULT_UOK_THRESHOLD);
    }
  });

  it('requiresUokStage: строго больше порога; без суммы — требуется', () => {
    expect(requiresUokStage(400_000.01, 400_000)).toBe(true);
    expect(requiresUokStage(400_000, 400_000)).toBe(false);
    expect(requiresUokStage(100, 400_000)).toBe(false);
    expect(requiresUokStage(null, 400_000)).toBe(true);
    expect(requiresUokStage(undefined, 400_000)).toBe(true);
  });
});
