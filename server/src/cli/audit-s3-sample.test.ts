/**
 * Unit-тесты audit-s3-sample: выборка ключей, расчёт byte-range диапазонов, побайтовое сравнение
 * и оркестрация auditSamples с инъектированным fetch (без @aws-sdk/сети). План Iteration 9, ADR-0004.
 */
import { describe, it, expect } from 'vitest';
import {
  sampleKeys,
  computeRanges,
  buffersEqual,
  auditSamples,
  type RangeFetcher,
} from './audit-s3-sample.js';
import type { ManifestEntry } from './compare-s3-manifests.js';

function entries(n: number): ManifestEntry[] {
  return Array.from({ length: n }, (_, i) => ({ Key: `k/${i}`, Size: 4096 }));
}

/** Детерминированный псевдо-random для воспроизводимой выборки. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('sampleKeys', () => {
  it('возвращает min(n, length) элементов', () => {
    expect(sampleKeys(entries(10), 3, seeded(1))).toHaveLength(3);
    expect(sampleKeys(entries(2), 50, seeded(1))).toHaveLength(2);
    expect(sampleKeys([], 5, seeded(1))).toHaveLength(0);
  });

  it('детерминирована при одинаковом random', () => {
    const a = sampleKeys(entries(20), 5, seeded(42)).map((e) => e.Key);
    const b = sampleKeys(entries(20), 5, seeded(42)).map((e) => e.Key);
    expect(a).toEqual(b);
  });

  it('возвращает уникальные ключи (без повторов из-за shuffle)', () => {
    const got = sampleKeys(entries(20), 8, seeded(7)).map((e) => e.Key);
    expect(new Set(got).size).toBe(got.length);
  });
});

describe('computeRanges', () => {
  it('size 0 → оба диапазона null', () => {
    expect(computeRanges(0)).toEqual({ first: null, last: null });
  });

  it('size ≤ edge → first покрывает весь объект, last null', () => {
    expect(computeRanges(500, 1024)).toEqual({ first: 'bytes=0-499', last: null });
    expect(computeRanges(1024, 1024)).toEqual({ first: 'bytes=0-1023', last: null });
  });

  it('size > edge → непересекающиеся first/last по edge байт', () => {
    expect(computeRanges(5000, 1024)).toEqual({
      first: 'bytes=0-1023',
      last: 'bytes=3976-4999',
    });
  });
});

describe('buffersEqual', () => {
  it('равные и неравные буферы', () => {
    expect(buffersEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(buffersEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(buffersEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('auditSamples', () => {
  const sample: ManifestEntry[] = [
    { Key: 'a', Size: 4096 },
    { Key: 'b', Size: 4096 },
    { Key: 'empty', Size: 0 },
  ];

  it('все диапазоны совпадают → passed == sampled, нет провалов', async () => {
    const fetch: RangeFetcher = (_side, key) =>
      Promise.resolve(new Uint8Array([key.charCodeAt(0)]));
    const r = await auditSamples({ entries: sample, sampleSize: 3, fetch, random: seeded(3) });
    expect(r.sampled).toBe(3);
    expect(r.passed).toBe(3);
    expect(r.failures).toHaveLength(0);
  });

  it('расхождение байтов источника и назначения → провал по ключу', async () => {
    const fetch: RangeFetcher = (side, _key) =>
      Promise.resolve(new Uint8Array([side === 'source' ? 1 : 2]));
    const r = await auditSamples({
      entries: [{ Key: 'a', Size: 4096 }],
      sampleSize: 1,
      fetch,
      random: seeded(1),
    });
    expect(r.passed).toBe(0);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]?.reason).toMatch(/различаются/);
  });

  it('ошибка скачивания → провал с текстом ошибки', async () => {
    const fetch: RangeFetcher = () => Promise.reject(new Error('403 Forbidden'));
    const r = await auditSamples({
      entries: [{ Key: 'a', Size: 4096 }],
      sampleSize: 1,
      fetch,
      random: seeded(1),
    });
    expect(r.failures[0]?.reason).toMatch(/403/);
  });

  it('пустой объект (Size 0) проходит без скачивания', async () => {
    let calls = 0;
    const fetch: RangeFetcher = () => {
      calls += 1;
      return Promise.resolve(new Uint8Array());
    };
    const r = await auditSamples({
      entries: [{ Key: 'empty', Size: 0 }],
      sampleSize: 1,
      fetch,
      random: seeded(1),
    });
    expect(r.passed).toBe(1);
    expect(calls).toBe(0);
  });
});
