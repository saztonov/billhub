/**
 * NotificationRepository — доступ к уведомлениям пользователя.
 * Strangler Fig: реализации — Supabase (rollback) и Drizzle.
 */
import type { NotificationDto } from '../schemas/notification.js';

export interface NotificationRepository {
  /** Непрочитанные уведомления пользователя (новейшие первыми, лимит 50), с именами связанных сущностей. */
  listUnread(userId: string): Promise<NotificationDto[]>;
  /** Число непрочитанных уведомлений пользователя. */
  countUnread(userId: string): Promise<number>;
  /** Пометить одно уведомление прочитанным. */
  markRead(id: string): Promise<void>;
  /** Пометить все уведомления пользователя прочитанными. */
  markAllRead(userId: string): Promise<void>;
}
