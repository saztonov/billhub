/**
 * DrizzleRepository для notification-actions (Iteration 5).
 * Воспроизводит логику services/notification-helpers.ts на Drizzle.
 * Вставка уведомлений — в db.transaction().
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  notifications,
  users,
  userConstructionSitesMapping,
  paymentRequests,
  contractRequests,
  rpStageAssignees,
} from '../../db/schema/index.js';
import type { NotificationActionRepository } from '../notification-action.repository.js';
import type {
  PaymentStatusChangedBody,
  PaymentRevisionBody,
  PaymentNewPendingBody,
  PaymentResubmittedBody,
  PaymentAssignedBody,
  PaymentNewCommentBody,
  PaymentNewFileBody,
  CheckSpecialistsBody,
  ContractNewRequestBody,
  ContractStatusChangedBody,
  ContractRevisionBody,
  ContractNewCommentBody,
  ContractNewFileBody,
} from '../../schemas/notification-action.js';

type Db = PostgresJsDatabase<typeof schema>;
type Dept = 'omts' | 'shtab' | 'smetny';
type NotifRow = typeof notifications.$inferInsert;

const DEPT_LABELS: Record<string, string> = { omts: 'ОМТС', shtab: 'Штаб', smetny: 'Сметный' };
const DEPARTMENT_RECIPIENTS = ['shtab', 'omts', 'smetny', 'counterparty'];

export class DrizzleNotificationActionRepository implements NotificationActionRepository {
  constructor(private readonly db: Db) {}

  private async insertNotifs(rows: NotifRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(notifications).values(rows);
    });
  }

  /** Пользователи подразделения, привязанные к объекту (или all_sites). */
  private async usersByDeptAndSite(
    dept: Dept,
    siteId: string,
    excludeUserId?: string,
  ): Promise<string[]> {
    const allSitesUsers = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.departmentId, dept),
          eq(users.allSites, true),
          eq(users.isActive, true),
          ne(users.role, 'counterparty_user'),
        ),
      );

    const mappings = await this.db
      .select({ userId: userConstructionSitesMapping.userId })
      .from(userConstructionSitesMapping)
      .where(eq(userConstructionSitesMapping.constructionSiteId, siteId));
    const siteUserIds = mappings.map((m) => m.userId);

    let deptSiteUsers: string[] = [];
    if (siteUserIds.length > 0) {
      const rows = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.departmentId, dept),
            eq(users.isActive, true),
            ne(users.role, 'counterparty_user'),
            eq(users.allSites, false),
            inArray(users.id, siteUserIds),
          ),
        );
      deptSiteUsers = rows.map((u) => u.id);
    }

    const ids = new Set<string>([...allSitesUsers.map((u) => u.id), ...deptSiteUsers]);
    if (excludeUserId) ids.delete(excludeUserId);
    return Array.from(ids);
  }

  private async getPaymentRequest(
    id: string,
  ): Promise<{ siteId: string; createdBy: string; requestNumber: string | null } | null> {
    const [row] = await this.db
      .select({
        siteId: paymentRequests.siteId,
        createdBy: paymentRequests.createdBy,
        requestNumber: paymentRequests.requestNumber,
      })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  private async getContractRequest(
    id: string,
  ): Promise<{ siteId: string; createdBy: string; requestNumber: string | null } | null> {
    const [row] = await this.db
      .select({
        siteId: contractRequests.siteId,
        createdBy: contractRequests.createdBy,
        requestNumber: contractRequests.requestNumber,
      })
      .from(contractRequests)
      .where(eq(contractRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  private async adminIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
    return rows.map((u) => u.id);
  }

  private label(num: string | null | undefined): string {
    return num ? ` N${num}` : '';
  }

  /* ----------------------------- Заявки на оплату ----------------------------- */

  async paymentStatusChanged(body: PaymentStatusChangedBody): Promise<void> {
    const { paymentRequestId, statusLabel, actorUserId } = body;
    const pr = await this.getPaymentRequest(paymentRequestId);
    if (!pr || !pr.createdBy || pr.createdBy === actorUserId) return;
    await this.insertNotifs([
      {
        userId: pr.createdBy,
        type: 'status_changed',
        title: 'Изменён статус заявки',
        message: `Статус заявки${this.label(pr.requestNumber)} изменён на «${statusLabel}»`,
        paymentRequestId,
      },
    ]);
  }

  async paymentRevision(body: PaymentRevisionBody): Promise<void> {
    const { paymentRequestId, actorUserId } = body;
    const pr = await this.getPaymentRequest(paymentRequestId);
    if (!pr || !pr.createdBy || pr.createdBy === actorUserId) return;
    await this.insertNotifs([
      {
        userId: pr.createdBy,
        type: 'status_changed',
        title: 'Заявка отправлена на доработку',
        message: `Заявка${this.label(pr.requestNumber)} отправлена на доработку`,
        paymentRequestId,
      },
    ]);
  }

  async paymentNewPending(body: PaymentNewPendingBody): Promise<void> {
    const { paymentRequestId, siteId, actorUserId, requestNumber } = body;
    const userIds = await this.usersByDeptAndSite('shtab', siteId, actorUserId);
    const label = this.label(requestNumber);
    await this.insertNotifs(
      userIds.map((uid) => ({
        userId: uid,
        type: 'new_pending',
        title: 'Новая заявка на согласовании',
        message: `Поступила заявка${label} на согласование`,
        paymentRequestId,
        siteId,
        departmentId: 'shtab' as const,
      })),
    );
  }

  async paymentResubmitted(body: PaymentResubmittedBody): Promise<void> {
    const { paymentRequestId, actorUserId, rejectedStage } = body;
    const pr = await this.getPaymentRequest(paymentRequestId);
    if (!pr) return;
    const label = this.label(pr.requestNumber);

    const shtabIds = await this.usersByDeptAndSite('shtab', pr.siteId, actorUserId);
    const rows: NotifRow[] = shtabIds.map((uid) => ({
      userId: uid,
      type: 'resubmitted',
      title: 'Повторная отправка заявки',
      message: `Заявка${label} отправлена повторно на согласование`,
      paymentRequestId,
      siteId: pr.siteId,
      departmentId: 'shtab' as const,
    }));

    if (rejectedStage === 2) {
      const omtsIds = await this.usersByDeptAndSite('omts', pr.siteId, actorUserId);
      for (const uid of omtsIds) {
        rows.push({
          userId: uid,
          type: 'resubmitted',
          title: 'Повторная отправка заявки',
          message: `Заявка${label} отправлена повторно на согласование`,
          paymentRequestId,
          siteId: pr.siteId,
          departmentId: 'omts' as const,
        });
      }
    }

    // Отклонение на этапе «РП» (stage 3): дополнительно уведомляем назначенца объекта.
    if (rejectedStage === 3) {
      const [assignee] = await this.db
        .select({ userId: rpStageAssignees.userId })
        .from(rpStageAssignees)
        .where(eq(rpStageAssignees.constructionSiteId, pr.siteId))
        .limit(1);
      if (assignee && assignee.userId !== actorUserId) {
        rows.push({
          userId: assignee.userId,
          type: 'resubmitted',
          title: 'Повторная отправка заявки',
          message: `Заявка${label} отправлена повторно на согласование`,
          paymentRequestId,
          siteId: pr.siteId,
          departmentId: 'rp' as const,
        });
      }
    }
    await this.insertNotifs(rows);
  }

  async paymentAssigned(body: PaymentAssignedBody): Promise<void> {
    const { paymentRequestId, assignedUserId, actorUserId } = body;
    if (assignedUserId === actorUserId) return;
    const pr = await this.getPaymentRequest(paymentRequestId);
    const label = this.label(pr?.requestNumber);
    await this.insertNotifs([
      {
        userId: assignedUserId,
        type: 'assigned',
        title: 'Вы назначены ответственным',
        message: `Вам назначена заявка${label} на обработку`,
        paymentRequestId,
      },
    ]);
  }

  /** Получатели комментария/файла к заявке на оплату (логика notification-helpers). */
  private async resolvePaymentRecipients(
    pr: { siteId: string; createdBy: string },
    actorUserId: string,
    recipient: string | null | undefined,
    defaultDept: Dept,
  ): Promise<string[]> {
    const ids = new Set<string>();
    if (recipient && DEPARTMENT_RECIPIENTS.includes(recipient)) {
      if (recipient === 'counterparty') {
        if (pr.createdBy !== actorUserId) ids.add(pr.createdBy);
      } else {
        (await this.usersByDeptAndSite(recipient as Dept, pr.siteId, actorUserId)).forEach((id) =>
          ids.add(id),
        );
      }
    } else if (recipient) {
      if (recipient !== actorUserId) ids.add(recipient);
    } else {
      if (pr.createdBy !== actorUserId) ids.add(pr.createdBy);
      (await this.usersByDeptAndSite(defaultDept, pr.siteId, actorUserId)).forEach((id) =>
        ids.add(id),
      );
    }
    return Array.from(ids);
  }

  async paymentNewComment(body: PaymentNewCommentBody): Promise<void> {
    const { paymentRequestId, actorUserId, recipient } = body;
    const pr = await this.getPaymentRequest(paymentRequestId);
    if (!pr) return;
    const targetIds = await this.resolvePaymentRecipients(pr, actorUserId, recipient, 'shtab');
    const label = this.label(pr.requestNumber);
    await this.insertNotifs(
      targetIds.map((uid) => ({
        userId: uid,
        type: 'new_comment',
        title: 'Новый комментарий',
        message: `Добавлен комментарий к заявке${label}`,
        paymentRequestId,
      })),
    );
  }

  async paymentNewFile(body: PaymentNewFileBody): Promise<void> {
    const { paymentRequestId, actorUserId } = body;
    const pr = await this.getPaymentRequest(paymentRequestId);
    if (!pr) return;
    const ids = new Set<string>();
    if (pr.createdBy !== actorUserId) ids.add(pr.createdBy);
    (await this.usersByDeptAndSite('shtab', pr.siteId, actorUserId)).forEach((id) => ids.add(id));
    const label = this.label(pr.requestNumber);
    await this.insertNotifs(
      Array.from(ids).map((uid) => ({
        userId: uid,
        type: 'new_file',
        title: 'Новый файл',
        message: `Добавлен файл к заявке${label}`,
        paymentRequestId,
      })),
    );
  }

  async checkSpecialists(body: CheckSpecialistsBody): Promise<void> {
    const { paymentRequestId, siteId, department } = body;
    const specialists = await this.usersByDeptAndSite(department, siteId);
    if (specialists.length > 0) return;
    const adminIds = await this.adminIds();
    const deptLabel = DEPT_LABELS[department] ?? department;
    await this.insertNotifs(
      adminIds.map((uid) => ({
        userId: uid,
        type: 'missing_specialist',
        title: 'Нет специалиста подразделения',
        message: `Для объекта не назначен специалист «${deptLabel}»`,
        paymentRequestId,
        siteId,
        departmentId: department,
      })),
    );
  }

  /* ----------------------------- Заявки на договор ----------------------------- */

  async contractNewRequest(body: ContractNewRequestBody): Promise<void> {
    const { contractRequestId, siteId, actorUserId, requestNumber } = body;
    const userIds = await this.usersByDeptAndSite('omts', siteId, actorUserId);
    const label = this.label(requestNumber);
    await this.insertNotifs(
      userIds.map((uid) => ({
        userId: uid,
        type: 'contract_new_request',
        title: 'Новая заявка на договор',
        message: `Поступила заявка на договор${label}`,
        contractRequestId,
        siteId,
        departmentId: 'omts' as const,
      })),
    );
  }

  async contractStatusChanged(body: ContractStatusChangedBody): Promise<void> {
    const { contractRequestId, statusLabel, actorUserId } = body;
    const cr = await this.getContractRequest(contractRequestId);
    if (!cr || !cr.createdBy || cr.createdBy === actorUserId) return;
    await this.insertNotifs([
      {
        userId: cr.createdBy,
        type: 'contract_status_changed',
        title: 'Изменён статус заявки на договор',
        message: `Статус заявки на договор${this.label(cr.requestNumber)} изменён на «${statusLabel}»`,
        contractRequestId,
      },
    ]);
  }

  async contractRevision(body: ContractRevisionBody): Promise<void> {
    const { contractRequestId, targets, actorUserId } = body;
    const cr = await this.getContractRequest(contractRequestId);
    if (!cr) return;
    const recipientIds = new Set<string>();
    for (const target of targets) {
      if (target === 'counterparty') {
        if (cr.createdBy && cr.createdBy !== actorUserId) recipientIds.add(cr.createdBy);
      } else if (target === 'shtab') {
        (await this.usersByDeptAndSite('shtab', cr.siteId, actorUserId)).forEach((id) =>
          recipientIds.add(id),
        );
      }
    }
    const label = this.label(cr.requestNumber);
    await this.insertNotifs(
      Array.from(recipientIds).map((uid) => ({
        userId: uid,
        type: 'contract_revision',
        title: 'Заявка на договор — доработка',
        message: `Заявка на договор${label} отправлена на доработку`,
        contractRequestId,
      })),
    );
  }

  async contractNewComment(body: ContractNewCommentBody): Promise<void> {
    const { contractRequestId, actorUserId, recipient } = body;
    const cr = await this.getContractRequest(contractRequestId);
    if (!cr) return;
    const targetIds = await this.resolvePaymentRecipients(cr, actorUserId, recipient, 'omts');
    const label = this.label(cr.requestNumber);
    await this.insertNotifs(
      targetIds.map((uid) => ({
        userId: uid,
        type: 'contract_new_comment',
        title: 'Новый комментарий',
        message: `Добавлен комментарий к заявке на договор${label}`,
        contractRequestId,
      })),
    );
  }

  async contractNewFile(body: ContractNewFileBody): Promise<void> {
    const { contractRequestId, actorUserId } = body;
    const cr = await this.getContractRequest(contractRequestId);
    if (!cr) return;
    const ids = new Set<string>();
    if (cr.createdBy !== actorUserId) ids.add(cr.createdBy);
    (await this.usersByDeptAndSite('omts', cr.siteId, actorUserId)).forEach((id) => ids.add(id));
    const label = this.label(cr.requestNumber);
    await this.insertNotifs(
      Array.from(ids).map((uid) => ({
        userId: uid,
        type: 'contract_new_file',
        title: 'Новый файл',
        message: `Добавлен файл к заявке на договор${label}`,
        contractRequestId,
      })),
    );
  }
}
