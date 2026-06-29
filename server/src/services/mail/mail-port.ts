/**
 * Порт почтовой абстракции @su10/mail (ADR-0001 / ADR-0007, стандарт §8).
 *
 * Этап 1 — реализация-заглушка (mail-stub.ts) пишет в защищённый локальный лог, а не отправляет
 * письма (email-провайдера ещё нет; SES/Postbox — отложено, ADR-0007). Этап 2 заменяет реализацию
 * БЕЗ изменения вызывающего кода — все вызовы идут только через этот интерфейс.
 */

export interface MailUser {
  id: string;
  email: string;
  fullName?: string;
}

/** Категории транзакционных писем (§8). */
export type MailKind =
  | 'password_reset'
  | 'user_invite'
  | 'security_notification'
  | 'workflow_notification';

/** Сообщение для отправки. token присутствует только для password_reset (как ссылка в письме). */
export interface MailMessage {
  kind: MailKind;
  to: MailUser;
  subject: string;
  /** Только для password_reset — plain-токен ссылки. Никогда не попадает в audit_log. */
  token?: string;
  /** Данные шаблона без секретов (имена, номера заявок и т.п.). */
  data?: Record<string, string>;
}

/** Результат доставки — БЕЗ секретов/токена (пригоден для audit). */
export interface MailDeliveryResult {
  kind: MailKind;
  accepted: boolean;
  at: string;
}

/** Тема письма по умолчанию для каждой категории (§8). */
export const DEFAULT_MAIL_SUBJECTS: Record<MailKind, string> = {
  password_reset: 'BillHub: сброс пароля',
  user_invite: 'BillHub: приглашение в портал',
  security_notification: 'BillHub: уведомление безопасности',
  workflow_notification: 'BillHub: уведомление по согласованию',
};

export interface MailPort {
  /**
   * Доставка письма по типизированному шаблону. Возвращает audit-безопасный результат
   * (без токена/ПДн). Реализация-заглушка фиксирует факт «отправки» в свой лог.
   */
  send(message: MailMessage): Promise<MailDeliveryResult>;

  /**
   * Доставка письма со ссылкой/токеном сброса пароля (обёртка над send).
   * plain-токен в Этапе 1 также возвращается админу copy-once через защищённый API.
   */
  sendPasswordReset(user: MailUser, token: string): Promise<void>;

  /**
   * Suppression-seam (§8: bounce/complaint suppression). Этап 1 — всегда false;
   * реальная реализация появится вместе с провайдером.
   */
  isSuppressed?(email: string): Promise<boolean>;
}
