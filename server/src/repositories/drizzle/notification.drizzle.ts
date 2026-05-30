/**
 * DrizzleRepository для уведомлений (Iteration 5).
 * Имена связанных сущностей — через leftJoin. Записи (mark-read) — в db.transaction().
 */
import { and, count, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  notifications,
  constructionSites,
  paymentRequests,
  contractRequests,
  suppliers,
} from '../../db/schema/index.js';
import type { NotificationRepository } from '../notification.repository.js';
import type { NotificationDto } from '../../schemas/notification.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async listUnread(userId: string): Promise<NotificationDto[]> {
    const rows = await this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        userId: notifications.userId,
        isRead: notifications.isRead,
        paymentRequestId: notifications.paymentRequestId,
        contractRequestId: notifications.contractRequestId,
        supplierId: notifications.supplierId,
        departmentId: notifications.departmentId,
        siteId: notifications.siteId,
        resolved: notifications.resolved,
        resolvedAt: notifications.resolvedAt,
        createdAt: notifications.createdAt,
        siteName: constructionSites.name,
        requestNumber: paymentRequests.requestNumber,
        contractRequestNumber: contractRequests.requestNumber,
        supplierName: suppliers.name,
      })
      .from(notifications)
      .leftJoin(constructionSites, eq(constructionSites.id, notifications.siteId))
      .leftJoin(paymentRequests, eq(paymentRequests.id, notifications.paymentRequestId))
      .leftJoin(contractRequests, eq(contractRequests.id, notifications.contractRequestId))
      .leftJoin(suppliers, eq(suppliers.id, notifications.supplierId))
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      userId: r.userId,
      isRead: r.isRead,
      paymentRequestId: r.paymentRequestId,
      contractRequestId: r.contractRequestId,
      supplierId: r.supplierId,
      departmentId: r.departmentId,
      siteId: r.siteId,
      resolved: r.resolved,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
      siteName: r.siteName ?? null,
      requestNumber: r.requestNumber ?? null,
      contractRequestNumber: r.contractRequestNumber ?? null,
      supplierName: r.supplierName ?? null,
    }));
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return Number(row?.value ?? 0);
  }

  async markRead(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    });
  }
}
