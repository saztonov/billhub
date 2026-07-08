/**
 * Repository-интерфейс домена «rp-stage» — назначения этапа согласования «РП»
 * (таблица rp_stage_assignees, миграция 0016): строго один сотрудник на объект.
 * Заменяет прежний omts-rp (единый ответственный + список объектов в settings).
 */

/** Назначение «объект -> сотрудник» с данными для таблицы настроек. */
export interface RpStageAssignee {
  id: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  userDepartment: string | null;
  siteId: string;
  siteName: string;
}

/** Кандидат в назначенцы: активный внутренний пользователь отдела Штаб/ОМТС. */
export interface RpStageCandidate {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
}

export interface RpStageRepository {
  /** Все назначения (join users + construction_sites), сортировка по объекту. */
  listAssignees(): Promise<RpStageAssignee[]>;
  /**
   * Назначить сотрудника на объект. Валидация: активный admin/user отдела shtab|omts,
   * существующий объект; занятый объект -> ConflictError (409).
   */
  addAssignee(siteId: string, userId: string): Promise<void>;
  /** Снять назначение по id записи. */
  removeAssignee(id: string): Promise<void>;
  /** Кандидаты в назначенцы (активные admin/user отделов shtab|omts). */
  listCandidates(): Promise<RpStageCandidate[]>;
  /** Объекты, на которые назначен пользователь (пусто — не назначенец РП). */
  getAssigneeSiteIds(userId: string): Promise<string[]>;
}
