/**
 * Правило «Штаба»: 1..SHTAB_MAX_SITES объектов при выключенном «Все объекты».
 * Хелпер применяется на всех путях записи привязок, поэтому тестируется отдельно от репозиториев.
 */
import { describe, it, expect } from 'vitest';
import { assertShtabSiteLimit, SHTAB_MAX_SITES } from './user-site-rules.js';
import { ValidationError } from './types.js';

const sites = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`);

describe('assertShtabSiteLimit', () => {
  it('пропускает набор в пределах лимита', () => {
    expect(() =>
      assertShtabSiteLimit({ department: 'shtab', allSites: false, siteIds: sites(1) }),
    ).not.toThrow();
    expect(() =>
      assertShtabSiteLimit({
        department: 'shtab',
        allSites: false,
        siteIds: sites(SHTAB_MAX_SITES),
      }),
    ).not.toThrow();
  });

  it('отклоняет пустой список у Штаба', () => {
    expect(() =>
      assertShtabSiteLimit({ department: 'shtab', allSites: false, siteIds: [] }),
    ).toThrow(ValidationError);
  });

  it('отклоняет превышение лимита', () => {
    expect(() =>
      assertShtabSiteLimit({
        department: 'shtab',
        allSites: false,
        siteIds: sites(SHTAB_MAX_SITES + 1),
      }),
    ).toThrow(ValidationError);
  });

  it('не применяется при allSites и к другим подразделениям', () => {
    expect(() =>
      assertShtabSiteLimit({ department: 'shtab', allSites: true, siteIds: [] }),
    ).not.toThrow();
    expect(() =>
      assertShtabSiteLimit({
        department: 'omts',
        allSites: false,
        siteIds: sites(SHTAB_MAX_SITES + 5),
      }),
    ).not.toThrow();
    expect(() =>
      assertShtabSiteLimit({ department: null, allSites: false, siteIds: [] }),
    ).not.toThrow();
  });
});
