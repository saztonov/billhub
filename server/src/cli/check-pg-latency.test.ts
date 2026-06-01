/**
 * Unit-тесты чистых функций check-pg-latency (без БД) — percentile/summarize/evaluate/plan.
 */
import { describe, it, expect } from 'vitest';
import {
  percentile,
  summarize,
  evaluate,
  buildDefaultPlan,
  DEFAULT_THRESHOLDS,
} from './check-pg-latency.js';

describe('check-pg-latency: percentile', () => {
  it('median и p95 на простой выборке 1..10', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 0.5)).toBeCloseTo(5.5, 5);
    expect(percentile(xs, 0.95)).toBeCloseTo(9.55, 5);
  });
  it('устойчив к неотсортированному входу', () => {
    expect(percentile([10, 1, 5], 0.5)).toBe(5);
  });
  it('единственный элемент', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });
  it('пустая выборка → NaN', () => {
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});

describe('check-pg-latency: summarize', () => {
  it('считает min/median/p95/max/count', () => {
    const s = summarize([5, 1, 3, 2, 4]);
    expect(s.count).toBe(5);
    expect(s.minMs).toBe(1);
    expect(s.maxMs).toBe(5);
    expect(s.medianMs).toBe(3);
  });
});

describe('check-pg-latency: evaluate (пороги ADR-0005)', () => {
  it('ok при median≤30 и p95≤50', () => {
    const v = evaluate({ count: 100, minMs: 1, medianMs: 12, p95Ms: 40, maxMs: 60 });
    expect(v.ok).toBe(true);
    expect(v.problems).toHaveLength(0);
  });
  it('провал median', () => {
    const v = evaluate({ count: 100, minMs: 1, medianMs: 35, p95Ms: 45, maxMs: 60 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/median/);
  });
  it('провал p95', () => {
    const v = evaluate({ count: 100, minMs: 1, medianMs: 10, p95Ms: 80, maxMs: 200 });
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/p95/);
  });
  it('пороги по умолчанию = 30/50', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ medianMs: 30, p95Ms: 50 });
  });
});

describe('check-pg-latency: buildDefaultPlan', () => {
  it('100 запросов: 30 select1 + 30 pk_lookup + 40 lateral_join', () => {
    const plan = buildDefaultPlan();
    expect(plan).toHaveLength(100);
    const count = (k: string): number => plan.filter((p) => p.kind === k).length;
    expect(count('select1')).toBe(30);
    expect(count('pk_lookup')).toBe(30);
    expect(count('lateral_join')).toBe(40);
  });
});
