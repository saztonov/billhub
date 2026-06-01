/**
 * Unit-тесты in-memory счётчика S3 error-rate (окно 60с, порог 5%, минимум сэмплов).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordS3Result,
  s3ErrorRateLastMinute,
  isS3ErrorRateBreached,
  __resetS3Samples,
} from './s3-error-rate.js';

describe('s3-error-rate', () => {
  beforeEach(() => __resetS3Samples());

  it('считает error-rate за окно', () => {
    let t = 1_000_000;
    const now = () => t;
    for (let i = 0; i < 90; i += 1) recordS3Result(true, now);
    for (let i = 0; i < 10; i += 1) recordS3Result(false, now);
    const snap = s3ErrorRateLastMinute(now);
    expect(snap.total).toBe(100);
    expect(snap.errors).toBe(10);
    expect(snap.errorRate).toBeCloseTo(0.1, 5);
  });

  it('окно 60с: старые сэмплы выпадают', () => {
    let t = 0;
    const now = () => t;
    recordS3Result(false, now); // t=0
    t = 61_000; // спустя 61с
    recordS3Result(true, now);
    const snap = s3ErrorRateLastMinute(now);
    expect(snap.total).toBe(1);
    expect(snap.errors).toBe(0);
  });

  it('isS3ErrorRateBreached: порог 5% + минимум сэмплов', () => {
    // 10% но мало сэмплов → не алертим
    expect(isS3ErrorRateBreached({ total: 5, errors: 1, errorRate: 0.2 }, 0.05, 20)).toBe(false);
    // 10% и достаточно сэмплов → алерт
    expect(isS3ErrorRateBreached({ total: 100, errors: 10, errorRate: 0.1 }, 0.05, 20)).toBe(true);
    // ровно 5% → не превышение (строго >)
    expect(isS3ErrorRateBreached({ total: 100, errors: 5, errorRate: 0.05 }, 0.05, 20)).toBe(false);
  });
});
