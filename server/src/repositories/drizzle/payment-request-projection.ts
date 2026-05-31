/**
 * Общая Drizzle-проекция списка/детали payment_requests с join-полями (Iteration 5).
 *
 * Источник правды для формы строки заявки: воспроизводит PR_SELECT + flattenPaymentRequest
 * (camelCase-алиасы = snake_case-ключи flatten после preSerialization). Используется
 * DrizzlePaymentRequestRepository и DrizzleApprovalRepository, чтобы списки заявок
 * (мои/pending/approved/rejected) имели идентичную форму на всех путях.
 *
 * Текущая привязка берётся через DISTINCT ON подзапрос — ОДНА строка на заявку, чтобы flat-join
 * не размножал родительские строки при нескольких is_current=true (индекс не UNIQUE).
 */
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  paymentRequests,
  counterparties,
  suppliers,
  constructionSites,
  costTypes,
  statuses,
  paymentRequestFieldOptions,
  paymentRequestAssignments,
  users,
} from '../../db/schema/index.js';

type Db = PostgresJsDatabase<typeof schema>;

/** Базовый select заявок с join-полями (без where/order — их навешивает вызывающий). */
export function joinedPaymentRequests(db: Db) {
  const statusT = alias(statuses, 'status_t');
  const paidStatusT = alias(statuses, 'paid_status_t');
  const assigneeT = alias(users, 'assignee');
  const curAssignment = db
    .selectDistinctOn([paymentRequestAssignments.paymentRequestId], {
      paymentRequestId: paymentRequestAssignments.paymentRequestId,
      assignedUserId: paymentRequestAssignments.assignedUserId,
    })
    .from(paymentRequestAssignments)
    .where(eq(paymentRequestAssignments.isCurrent, true))
    .orderBy(paymentRequestAssignments.paymentRequestId, asc(paymentRequestAssignments.assignedAt))
    .as('cur_assignment');

  return db
    .select({
      ...getTableColumns(paymentRequests),
      counterpartyName: counterparties.name,
      counterpartyInn: counterparties.inn,
      supplierName: suppliers.name,
      supplierInn: suppliers.inn,
      supplierLastSecurityStatus: suppliers.lastSecurityStatus,
      siteName: constructionSites.name,
      statusName: statusT.name,
      statusColor: statusT.color,
      paidStatusName: paidStatusT.name,
      paidStatusColor: paidStatusT.color,
      shippingConditionValue: paymentRequestFieldOptions.value,
      costTypeName: costTypes.name,
      assignedUserId: curAssignment.assignedUserId,
      assignedUserEmail: assigneeT.email,
      assignedUserFullName: assigneeT.fullName,
    })
    .from(paymentRequests)
    .leftJoin(counterparties, eq(counterparties.id, paymentRequests.counterpartyId))
    .leftJoin(suppliers, eq(suppliers.id, paymentRequests.supplierId))
    .leftJoin(constructionSites, eq(constructionSites.id, paymentRequests.siteId))
    .leftJoin(statusT, eq(statusT.id, paymentRequests.statusId))
    .leftJoin(paidStatusT, eq(paidStatusT.id, paymentRequests.paidStatusId))
    .leftJoin(
      paymentRequestFieldOptions,
      eq(paymentRequestFieldOptions.id, paymentRequests.shippingConditionId),
    )
    .leftJoin(costTypes, eq(costTypes.id, paymentRequests.costTypeId))
    .leftJoin(curAssignment, eq(curAssignment.paymentRequestId, paymentRequests.id))
    .leftJoin(assigneeT, eq(assigneeT.id, curAssignment.assignedUserId));
}
