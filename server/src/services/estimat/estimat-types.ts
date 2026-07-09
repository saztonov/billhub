/**
 * DTO исходящего канала событий BillHub → EstiMat. Зеркалит контракт приёмника EstiMat
 * (integrationEventSchema, EstiMat/shared/src/schemas/payment-request.ts): каждое событие
 * несёт полный snapshot проекции заявки на оплату и монотонную aggregateVersion.
 */

/** Типы событий (совпадают с EstiMat INTEGRATION_EVENT_TYPES). */
export type EstimatEventType =
  | 'payment_request.workflow_changed'
  | 'payment_request.document_attached'
  | 'payment_request.rp_changed'
  | 'payment_request.rp_unlinked'
  | 'payment_request.payment_summary_changed';

/** Документ в snapshot (opaque id + метаданные; байты EstiMat при необходимости тянет отдельно). */
export interface EstimatSnapshotDocument {
  documentId: string;
  documentType?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

/** Полный снимок проекции заявки на оплату (три независимые оси: согласование/РП/оплата). */
export interface EstimatSnapshot {
  statusCode?: string | null; // approv_shtab|approv_omts|approv_rp|approved|revision|rejected|withdrawn
  actionRequired?: boolean | null;
  revisionComment?: string | null;
  requestNumber?: string | null;
  requestUrl?: string | null;
  rpNumber?: string | null;
  rpDate?: string | null; // ISO date
  paidStatus?: string | null; // not_paid|partially_paid|paid
  totalPaid?: number | null;
  lastPaymentDate?: string | null;
  documents?: EstimatSnapshotDocument[] | null;
}

/** Конверт события BillHub → EstiMat. */
export interface EstimatEvent {
  schemaVersion: number;
  eventId: string;
  type: EstimatEventType;
  externalRef: string;
  bhRequestId?: string | null;
  aggregateVersion: number;
  occurredAt?: string | null;
  correlationId?: string | null;
  snapshot: EstimatSnapshot;
}

/** Результат применения события на стороне EstiMat. */
export type EstimatEventResult = 'applied' | 'ignored_stale' | 'duplicate';
