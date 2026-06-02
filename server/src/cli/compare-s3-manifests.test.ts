/**
 * Unit-тесты compare-s3-manifests: парсинг манифеста и сверка count/total_size с допуском ±0.1%.
 * Без fs/сети — чистая логика (план Iteration 9, ADR-0004).
 */
import { describe, it, expect } from 'vitest';
import {
  parseManifest,
  summarize,
  compareManifests,
  type ManifestEntry,
} from './compare-s3-manifests.js';

function entry(key: string, size: number): ManifestEntry {
  return { Key: key, Size: size };
}

describe('parseManifest', () => {
  it('принимает массив {Key, Size} и приводит строковый Size к числу', () => {
    const parsed = parseManifest([
      { Key: 'a/1.pdf', Size: 100 },
      { Key: 'b/2.pdf', Size: '250', LastModified: '2026-01-01', ETag: '"x"' },
    ]);
    expect(parsed).toEqual([entry('a/1.pdf', 100), entry('b/2.pdf', 250)]);
  });

  it('бросает на не-массиве и на отсутствии Key', () => {
    expect(() => parseManifest({})).toThrow();
    expect(() => parseManifest([{ Size: 1 }])).toThrow();
    expect(() => parseManifest([{ Key: 'a', Size: -1 }])).toThrow();
  });
});

describe('summarize', () => {
  it('считает count, totalBytes и множество ключей', () => {
    const s = summarize([entry('a', 10), entry('b', 20), entry('c', 0)]);
    expect(s.count).toBe(3);
    expect(s.totalBytes).toBe(30);
    expect(s.keys.has('b')).toBe(true);
  });
});

describe('compareManifests', () => {
  const base = [entry('a', 1000), entry('b', 2000), entry('c', 3000)];

  /** Большой базис (2000 одинаковых по содержимому ключей) — для демонстрации допуска ±0.1%. */
  function bigBase(): ManifestEntry[] {
    return Array.from({ length: 2000 }, (_, i) => entry(`k/${i}`, 1000));
  }

  it('идентичные манифесты → ok', () => {
    const r = compareManifests(base, [...base]);
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
    expect(r.sourceBytes).toBe(6000);
    expect(r.targetBytes).toBe(6000);
  });

  it('покейное расхождение Size → ok=false (sizeMismatch)', () => {
    const target = [entry('a', 1000), entry('b', 2000), entry('c', 3005)];
    const r = compareManifests(base, target);
    expect(r.sizeMismatch).toEqual(['c']);
    expect(r.ok).toBe(false);
  });

  it('пропущенный в target ключ источника → ok=false (missingInTarget)', () => {
    const target = [entry('a', 1000), entry('b', 2000)]; // потеряли c
    const r = compareManifests(base, target);
    expect(r.ok).toBe(false);
    expect(r.missingInTarget).toContain('c');
    expect(r.reasons.join(' ')).toMatch(/отсутству|count|total_size/);
  });

  it('лишние ключи в target в пределах ±0.1% → ok (snapshot Cloud.ru чуть позже T1)', () => {
    // 2000 исходных ключей + 1 новый (0.05% по count, +0.05% по total) — в пределах допуска.
    const target = [...bigBase(), entry('k/new', 1000)];
    const r = compareManifests(bigBase(), target);
    expect(r.extraInTarget).toEqual(['k/new']);
    expect(r.missingInTarget).toHaveLength(0);
    expect(r.sizeMismatch).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('count вне допуска ±0.1% → ok=false', () => {
    // +50 лишних ключей к 2000 = +2.5% по count → за пределами 0.1%.
    const extra = Array.from({ length: 50 }, (_, i) => entry(`k/extra-${i}`, 1000));
    const r = compareManifests(bigBase(), [...bigBase(), ...extra]);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('count'))).toBe(true);
  });

  it('допуск настраивается через sizeTolerance', () => {
    const target = [...bigBase(), entry('k/new', 1000)];
    const strict = compareManifests(bigBase(), target, { countTolerance: 0, sizeTolerance: 0 });
    expect(strict.ok).toBe(false);
    const loose = compareManifests(bigBase(), target, { countTolerance: 0.1, sizeTolerance: 0.1 });
    expect(loose.ok).toBe(true);
  });
});
