/**
 * zod-схема DTO уведомления (response). Уведомления создаются другими бизнес-потоками,
 * поэтому create/update-схемы здесь не нужны — только форма ответа списка.
 */
import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  userId: z.string(),
  isRead: z.boolean(),
  paymentRequestId: z.string().nullable(),
  contractRequestId: z.string().nullable(),
  supplierId: z.string().nullable(),
  departmentId: z.string().nullable(),
  siteId: z.string().nullable(),
  resolved: z.boolean(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  /** Денормализованные имена из связанных сущностей (join) */
  siteName: z.string().nullable(),
  requestNumber: z.string().nullable(),
  contractRequestNumber: z.string().nullable(),
  supplierName: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
