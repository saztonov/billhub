/**
 * ContractRequestRepository — заявки на договор. Чистый status-state-machine (без approval_decisions).
 * Strangler Fig: Supabase (rollback) и Drizzle. Записи — в db.transaction().
 *
 * Статусы (entity_type='contract_request') резолвятся по коду в рантайме:
 *   approv_omts → on_revision/approved_waiting → concluded; rejected (миграция 005).
 */
import type {
  UpdateContractRequestBody,
  ContractDetailsBody,
  AddContractFileBody,
} from '../schemas/contract-request.js';

export type ContractRequestRow = Record<string, unknown>;

export interface ContractRequestListFilter {
  showDeleted?: boolean;
  counterpartyId?: string;
  /** Пустой массив ⇒ пустой результат. */
  siteIds?: string[];
  supplierId?: string;
  siteId?: string;
  statusId?: string;
  pagination?: { page: number; pageSize: number };
}

export interface ContractStatusCounts {
  approv_omts: number;
  on_revision: number;
  concluded: number;
}

export interface CreateContractRequestInput {
  siteId: string;
  counterpartyId: string;
  supplierId: string;
  partiesCount: number;
  subjectType: string;
  subjectDetail?: string | null;
  createdBy: string;
}

export interface ContractRequestRepository {
  list(filter: ContractRequestListFilter): Promise<ContractRequestRow[]>;
  getUserSiteIds(userId: string): Promise<string[]>;
  statusCounts(filter: {
    counterpartyId?: string;
    siteIds?: string[];
  }): Promise<ContractStatusCounts>;
  getById(id: string): Promise<ContractRequestRow | null>;
  getOwnerCounterpartyId(id: string): Promise<string | null>;
  /** Для PUT-авторизации: counterparty_id + код статуса. null если заявка не найдена. */
  getStatusGate(
    id: string,
  ): Promise<{ counterpartyId: string | null; statusCode: string | null } | null>;
  /** supplier_id заявки (для SB-guard при approve). null если нет. */
  getSupplierId(id: string): Promise<string | null>;

  create(input: CreateContractRequestInput): Promise<{ requestId: string; requestNumber: string }>;
  /** Обновление полей; stripCounterparty убирает counterparty_id (подрядчик). Авторизация — в роуте. */
  update(
    id: string,
    patch: UpdateContractRequestBody,
    opts: { stripCounterparty: boolean },
  ): Promise<void>;
  softDelete(id: string): Promise<void>;
  setContractDetails(id: string, body: ContractDetailsBody): Promise<void>;

  /* --- Переходы статусов (status_history append) --- */
  sendToRevision(id: string, targets: string[], userId: string): Promise<void>;
  /** Завершить доработку по target; пустой остаток → возврат в approv_omts. Бросает NotFoundError. */
  completeRevision(id: string, target: string, userId: string): Promise<void>;
  approve(id: string, userId: string): Promise<void>;
  markOriginalReceived(id: string, userId: string): Promise<void>;
  /** Возврат на предыдущий этап. Бросает NotFoundError, ValidationError (нет предыдущего). */
  revertToPrevious(id: string, userId: string, comment?: string | null): Promise<void>;
  /** Отклонить (статус rejected). Бросает NotFoundError, ValidationError (нельзя из concluded/rejected). */
  reject(id: string, userId: string, comment: string): Promise<void>;
  assign(id: string, userId: string): Promise<void>;

  /* --- Файлы --- */
  listFiles(contractRequestId: string): Promise<ContractRequestRow[]>;
  /** is_signed_contract разрешён только в статусах approved_waiting/concluded (гейтится здесь). */
  addFile(contractRequestId: string, file: AddContractFileBody): Promise<void>;
  getFileRejection(fileId: string): Promise<boolean | null>;
  setFileRejection(fileId: string, isRejected: boolean, rejectedBy: string | null): Promise<void>;
  setSignedContract(fileId: string, isSignedContract: boolean): Promise<void>;
}
