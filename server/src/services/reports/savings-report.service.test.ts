import { describe, it, expect } from 'vitest';
import { shiftMonth, currentMonth, resolvePeriod } from './savings-report.service.js';

describe('shiftMonth', () => {
  it('сдвигает месяц вперёд через границу года', () => {
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
  });

  it('сдвигает месяц назад через границу года', () => {
    expect(shiftMonth('2026-02', -3)).toBe('2025-11');
  });

  it('нулевой сдвиг возвращает тот же месяц', () => {
    expect(shiftMonth('2026-08', 0)).toBe('2026-08');
  });
});

describe('currentMonth', () => {
  it('берёт месяц в отчётном часовом поясе (+05), а не в UTC', () => {
    // 31.07 в 20:00 UTC — это уже 01.08 по Екатеринбургу.
    expect(currentMonth(new Date('2026-07-31T20:00:00.000Z'))).toBe('2026-08');
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-08-15T09:00:00.000Z');

  it('по умолчанию — последние 12 месяцев, текущий последний', () => {
    expect(resolvePeriod({}, now)).toEqual({ from: '2025-09', to: '2026-08' });
  });

  it('достраивает вторую границу окном в 12 месяцев', () => {
    expect(resolvePeriod({ from: '2026-01' }, now)).toEqual({ from: '2026-01', to: '2026-12' });
    expect(resolvePeriod({ to: '2026-06' }, now)).toEqual({ from: '2025-07', to: '2026-06' });
  });

  it('нормализует перевёрнутый период', () => {
    expect(resolvePeriod({ from: '2026-08', to: '2026-03' }, now)).toEqual({
      from: '2026-03',
      to: '2026-08',
    });
  });
});
