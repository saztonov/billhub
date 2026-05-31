/**
 * Repository-интерфейс домена «omts-rp» (настройки распределительных писем ОМТС).
 * Хранится в settings (key/value jsonb): omts_rp_config.responsible_user_id, omts_rp_sites.site_ids.
 */
export type Row = Record<string, unknown>;

export interface OmtsRpRepository {
  /** responsible_user_id из omts_rp_config (null, если ключа нет). */
  getResponsibleUserId(): Promise<string | null>;
  /** Объекты {id,name} из omts_rp_sites.site_ids (строго: нет ключа → ошибка). */
  getSites(): Promise<Row[]>;
  /** Добавить/удалить объект в omts_rp_sites.site_ids (read-modify-write). */
  updateSites(action: 'add' | 'remove', siteId: string): Promise<void>;
  /** Установить responsible_user_id в omts_rp_config. */
  setResponsibleUserId(userId: string | null): Promise<void>;
}
