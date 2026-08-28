/**
 * Правила доступа пользователя к объектам строительства.
 *
 * Единственный источник лимита для подразделения «Штаб»: сотрудник штаба ведёт ограниченное
 * число объектов, поэтому при выключенном «Все объекты» список обязан быть непустым и не
 * длиннее SHTAB_MAX_SITES. Правило прикладное (ограничения в БД нет), поэтому применяется на
 * ВСЕХ путях записи привязок: обновление карточки, создание пользователя, точечная установка
 * объектов. Фронтовая копия константы — SHTAB_MAX_SITES в src/types/index.ts.
 */
import { ValidationError } from './types.js';

/** Максимум объектов строительства у сотрудника подразделения «Штаб». */
export const SHTAB_MAX_SITES = 6;

interface ShtabSiteLimitInput {
  /** Подразделение пользователя (department_enum) либо null для подрядчиков. */
  department: string | null | undefined;
  /** Признак «Все объекты»: при нём привязки не используются и лимит неприменим. */
  allSites: boolean;
  siteIds: string[];
}

/**
 * Бросает ValidationError (→ HTTP 400), если набор объектов нарушает правило «Штаба».
 * Для прочих подразделений и при allSites — no-op.
 */
export function assertShtabSiteLimit({ department, allSites, siteIds }: ShtabSiteLimitInput): void {
  if (department !== 'shtab' || allSites) return;
  if (siteIds.length === 0) {
    throw new ValidationError('Для подразделения Штаб необходимо выбрать хотя бы один объект');
  }
  if (siteIds.length > SHTAB_MAX_SITES) {
    throw new ValidationError(
      `Для подразделения Штаб можно выбрать не более ${SHTAB_MAX_SITES} объектов`,
    );
  }
}
