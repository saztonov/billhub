/**
 * Repository-интерфейс домена «approvals» (Iteration 5, Phase 7).
 *
 * Инкапсулирует машину состояний согласования (Штаб → ОМТС → [РП, этап 3 для объектов
 * с назначенцем в rp_stage_assignees] → Согласовано, либо Отклонено / Доработка /
 * Завершение доработки) и read-эндпоинты очередей и счётчиков.
 *
 * Контракт ошибок: write-методы, требующие точного HTTP-статуса и текста (как в исходных
 * роутах), возвращают объект-результат { ok:false, status, error } вместо доменных исключений —
 * это сохраняет байт-в-байт текущее поведение (статус + сообщение). Технические сбои БД
 * пробрасываются как исключения (центральный error-handler → 500).
 */
import type { ApprovalFieldUpdates } from '../schemas/approval.js';

export type Row = Record<string, unknown>;

/** Вход решения (/decide и /create-decision). */
export interface ApprovalDecideInput {
  paymentRequestId: string;
  /** Легаси-поле тела запроса: для матчинга НЕ используется (этап определяет current_stage). */
  department?: string;
  action: 'approve' | 'reject';
  comment?: string;
  userId: string;
  /** Отдел пользователя (users.department_id) — серверная авторизация по этапам 1/2. */
  userDepartment?: string | null;
  /** role==='admin' || query.isAdmin==='true' — включает админ-путь форс-отклонения. */
  isAdmin: boolean;
}

/** Результат decide: успех (для reject — с decisionId/requestNumber) либо доменная ошибка. */
export type ApprovalDecideResult =
  | { ok: true; decisionId?: string | null; requestNumber?: string }
  | { ok: false; status: number; error: string };

/** Результат частичного решения (/create-decision): только запись в approval_decisions. */
export type ApprovalCreateDecisionResult =
  | { ok: true; decisionId: string }
  | { ok: false; status: number; error: string };

/** Результат send-to-revision / complete-revision. */
export type ApprovalOpResult = { ok: true } | { ok: false; status: number; error: string };

/** Сайт-скоуп из query-параметров (admin override уже учтён вызывающим). */
export interface QueryScope {
  allSites: boolean;
  siteIds: string[];
  /** true — включить удалённые (is_deleted=true) в выборку/счётчик; по умолчанию только активные. */
  showDeleted?: boolean;
}

export interface AddDecisionFileInput {
  approvalDecisionId: string;
  fileName: string;
  fileKey: string;
  fileSize: number | null;
  mimeType: string | null;
  createdBy: string;
}

export interface ApprovalRepository {
  /* ---------- read: решения и логи заявки ---------- */
  listDecisionsByRequest(requestId: string): Promise<Row[]>;
  listLogsByRequest(requestId: string): Promise<Row[]>;

  /* ---------- read: очереди (site-scope через getUserSiteIds) ---------- */
  listPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<Row[]>;
  /** Очередь этапа «РП»: админ — вся, назначенец — только заявки своих объектов. */
  listRpPending(opts: { userId: string; isAdmin: boolean }): Promise<Row[]>;
  listApproved(opts: { userId: string }): Promise<{ data: Row[]; total: number }>;
  listRejected(opts: { userId: string }): Promise<{ data: Row[]; total: number }>;

  /* ---------- read: списки-массивы (site-scope из query) ---------- */
  listApprovedArray(opts: QueryScope): Promise<Row[]>;
  listRejectedArray(opts: QueryScope): Promise<Row[]>;

  /* ---------- read: счётчики ---------- */
  countApproved(opts: QueryScope): Promise<number>;
  countRejected(opts: QueryScope): Promise<number>;
  countAll(opts: QueryScope): Promise<number>;
  countPendingByDepartment(opts: {
    userId: string;
    department: string;
    isAdmin: boolean;
  }): Promise<number>;
  countUnassignedSpecialists(opts: { userId: string }): Promise<number>;
  countRpPending(opts: { userId: string; isAdmin: boolean }): Promise<number>;
  countReadyForClosure(opts: { userId: string }): Promise<number>;

  /* ---------- write: машина состояний ---------- */
  decide(input: ApprovalDecideInput): Promise<ApprovalDecideResult>;
  sendToRevision(
    paymentRequestId: string,
    userId: string,
    comment: string,
  ): Promise<ApprovalOpResult>;
  completeRevision(
    paymentRequestId: string,
    userId: string,
    fieldUpdates: ApprovalFieldUpdates,
  ): Promise<ApprovalOpResult>;
  appendStageHistory(paymentRequestId: string, entry: Row): Promise<void>;
  createDecisionOnly(input: ApprovalDecideInput): Promise<ApprovalCreateDecisionResult>;

  /* ---------- write: файлы решений ---------- */
  addDecisionFile(file: AddDecisionFileInput): Promise<{ id: string }>;
  deleteDecisionFile(id: string): Promise<void>;
}
