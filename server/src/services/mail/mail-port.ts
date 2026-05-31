/**
 * Порт почтовой абстракции @su10/mail (ADR-0001, план Iteration 6).
 *
 * Этап 1 — реализация-заглушка (mail-stub.ts) пишет в локальный JSON-лог, а не отправляет
 * письма (email-провайдера ещё нет). Этап 2 заменяет реализацию на SES/Postbox БЕЗ изменения
 * вызывающего кода — все вызовы идут только через этот интерфейс.
 */

export interface MailUser {
  id: string;
  email: string;
  fullName?: string;
}

export interface MailPort {
  /**
   * Доставка письма со ссылкой/токеном сброса пароля.
   * В Этапе 1 plain-токен также возвращается админу copy-once через защищённый API —
   * заглушка лишь фиксирует факт «отправки» в свой JSON-лог (НЕ в audit_log).
   */
  sendPasswordReset(user: MailUser, token: string): Promise<void>;
}
