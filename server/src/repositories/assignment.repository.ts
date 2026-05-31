/**
 * Repository-интерфейс домена «assignments» (назначение специалиста на заявку).
 */
export type Row = Record<string, unknown>;

export interface CreateAssignmentInput {
  paymentRequestId: string;
  assignedUserId: string;
  assignedByUserId: string;
}

export interface AssignmentRepository {
  /** Текущее назначение заявки (is_current=true) или null. */
  getCurrent(paymentRequestId: string): Promise<Row | null>;
  /** История назначений заявки, новые сверху. */
  listByRequest(paymentRequestId: string): Promise<Row[]>;
  /** Создать назначение: снять текущее + вставить новое (is_current=true). */
  create(input: CreateAssignmentInput): Promise<void>;
  /** Сотрудники ОМТС (department_id='omts', активные, role admin|user), по ФИО. */
  listOmtsUsers(): Promise<Row[]>;
}
