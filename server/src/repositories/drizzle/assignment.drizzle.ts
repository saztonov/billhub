/**
 * DrizzleAssignmentRepository (Iteration 5). Назначения специалистов; create — в транзакции.
 */
import { and, asc, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import { paymentRequestAssignments, users } from '../../db/schema/index.js';
import type { AssignmentRepository, CreateAssignmentInput, Row } from '../assignment.repository.js';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleAssignmentRepository implements AssignmentRepository {
  constructor(private readonly db: Db) {}

  private joined() {
    const assignedUserT = alias(users, 'assigned_user');
    const assignedByUserT = alias(users, 'assigned_by_user');
    return this.db
      .select({
        ...getTableColumns(paymentRequestAssignments),
        assignedUserEmail: assignedUserT.email,
        assignedUserFullName: assignedUserT.fullName,
        assignedByUserEmail: assignedByUserT.email,
      })
      .from(paymentRequestAssignments)
      .leftJoin(assignedUserT, eq(assignedUserT.id, paymentRequestAssignments.assignedUserId))
      .leftJoin(
        assignedByUserT,
        eq(assignedByUserT.id, paymentRequestAssignments.assignedByUserId),
      );
  }

  async getCurrent(paymentRequestId: string): Promise<Row | null> {
    const [row] = await this.joined()
      .where(
        and(
          eq(paymentRequestAssignments.paymentRequestId, paymentRequestId),
          eq(paymentRequestAssignments.isCurrent, true),
        ),
      )
      .limit(1);
    return (row as Row) ?? null;
  }

  async listByRequest(paymentRequestId: string): Promise<Row[]> {
    return (await this.joined()
      .where(eq(paymentRequestAssignments.paymentRequestId, paymentRequestId))
      .orderBy(desc(paymentRequestAssignments.assignedAt))) as Row[];
  }

  async create(input: CreateAssignmentInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRequestAssignments)
        .set({ isCurrent: false })
        .where(
          and(
            eq(paymentRequestAssignments.paymentRequestId, input.paymentRequestId),
            eq(paymentRequestAssignments.isCurrent, true),
          ),
        );
      await tx.insert(paymentRequestAssignments).values({
        paymentRequestId: input.paymentRequestId,
        assignedUserId: input.assignedUserId,
        assignedByUserId: input.assignedByUserId,
        isCurrent: true,
      });
    });
  }

  async listOmtsUsers(): Promise<Row[]> {
    return (await this.db
      .select({ id: users.id, email: users.email, full_name: users.fullName })
      .from(users)
      .where(
        and(
          eq(users.departmentId, 'omts'),
          eq(users.isActive, true),
          inArray(users.role, ['admin', 'user']),
        ),
      )
      .orderBy(asc(users.fullName))) as Row[];
  }
}
