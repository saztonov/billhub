/**
 * SupabaseRepository для заявок на договор (Strangler Fig, rollback-инструмент).
 * Воспроизводит исходную логику роута contract-requests.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ContractRequestRepository,
  ContractRequestListFilter,
  ContractRequestRow,
  ContractStatusCounts,
  CreateContractRequestInput,
} from '../contract-request.repository.js';
import type {
  UpdateContractRequestBody,
  ContractDetailsBody,
  AddContractFileBody,
} from '../../schemas/contract-request.js';
import { NotFoundError, ValidationError } from '../types.js';

const CR_LIST_SELECT = `
  id, request_number, site_id, counterparty_id, supplier_id,
  parties_count, subject_type, subject_detail, status_id,
  revision_targets, created_by, created_at,
  is_deleted, deleted_at, original_received_at, status_history,
  responsible_user_id, contract_number, contract_signing_date,
  counterparties(name, inn),
  suppliers(name, inn, last_security_status),
  construction_sites(name),
  statuses!contract_requests_status_id_fkey(name, color, code),
  creator:users!contract_requests_created_by_fkey(full_name),
  responsible:users!contract_requests_responsible_user_id_fkey(full_name)
`;

const CONTRACT_PREVIOUS_STATUS: Record<string, string> = {
  on_revision: 'approv_omts',
  approved_waiting: 'approv_omts',
  concluded: 'approved_waiting',
  rejected: 'approv_omts',
};

const UPDATE_FIELD_MAP: Record<string, string> = {
  siteId: 'site_id',
  counterpartyId: 'counterparty_id',
  supplierId: 'supplier_id',
  partiesCount: 'parties_count',
  subjectType: 'subject_type',
  subjectDetail: 'subject_detail',
};

function flattenContractRequest(row: Record<string, unknown>): ContractRequestRow {
  const cp = row.counterparties as Record<string, unknown> | null;
  const sup = row.suppliers as Record<string, unknown> | null;
  const site = row.construction_sites as Record<string, unknown> | null;
  const status = row.statuses as Record<string, unknown> | null;
  const creator = row.creator as Record<string, unknown> | null;
  const responsible = row.responsible as Record<string, unknown> | null;
  const flat = { ...row };
  delete flat.counterparties;
  delete flat.suppliers;
  delete flat.construction_sites;
  delete flat.statuses;
  delete flat.creator;
  delete flat.responsible;
  flat.counterparty_name = cp?.name ?? null;
  flat.counterparty_inn = cp?.inn ?? null;
  flat.supplier_name = sup?.name ?? null;
  flat.supplier_inn = sup?.inn ?? null;
  flat.supplier_last_security_status = sup?.last_security_status ?? null;
  flat.site_name = site?.name ?? null;
  flat.status_name = status?.name ?? null;
  flat.status_color = status?.color ?? null;
  flat.status_code = status?.code ?? null;
  flat.creator_full_name = creator?.full_name ?? null;
  flat.responsible_user_full_name = responsible?.full_name ?? null;
  return flat;
}

function flattenContractRequestFile(row: Record<string, unknown>): ContractRequestRow {
  const user = row.users as Record<string, unknown> | null;
  const counterparty = user?.counterparties as Record<string, unknown> | null;
  const flat = { ...row };
  delete flat.users;
  flat.uploader_role = user?.role ?? null;
  flat.uploader_department = user?.department_id ?? null;
  flat.uploader_counterparty_name = counterparty?.name ?? null;
  return flat;
}

export class SupabaseContractRequestRepository implements ContractRequestRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  private async getStatusId(code: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('statuses')
      .select('id')
      .eq('entity_type', 'contract_request')
      .eq('code', code)
      .single();
    if (error || !data) throw new Error(`Статус contract_request/${code} не найден`);
    return data.id as string;
  }

  /** Код статуса по id (вместо PostgREST-вложенного join — для совместимости/тестируемости). */
  private async statusCodeById(statusId: string | null): Promise<string | null> {
    if (!statusId) return null;
    const { data } = await this.supabase
      .from('statuses')
      .select('code')
      .eq('id', statusId)
      .maybeSingle();
    return (data?.code as string | null) ?? null;
  }

  private async appendStatusHistory(
    id: string,
    entry: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const { data: userData } = await this.supabase
      .from('users')
      .select('full_name, email')
      .eq('id', userId)
      .single();
    const { data: current } = await this.supabase
      .from('contract_requests')
      .select('status_history')
      .eq('id', id)
      .single();
    const history = (current?.status_history as Record<string, unknown>[]) ?? [];
    history.push({
      ...entry,
      at: new Date().toISOString(),
      userFullName: (userData?.full_name as string | undefined) ?? undefined,
      userEmail: (userData?.email as string | undefined) ?? undefined,
    });
    await this.supabase.from('contract_requests').update({ status_history: history }).eq('id', id);
  }

  async getUserSiteIds(userId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('user_construction_sites_mapping')
      .select('construction_site_id')
      .eq('user_id', userId);
    return (data ?? []).map((s: Record<string, unknown>) => s.construction_site_id as string);
  }

  async list(filter: ContractRequestListFilter): Promise<ContractRequestRow[]> {
    if (filter.siteIds && filter.siteIds.length === 0) return [];
    let q = this.supabase
      .from('contract_requests')
      .select(CR_LIST_SELECT)
      .order('created_at', { ascending: false });
    if (!filter.showDeleted) q = q.eq('is_deleted', false);
    if (filter.counterpartyId) q = q.eq('counterparty_id', filter.counterpartyId);
    if (filter.siteIds && filter.siteIds.length > 0) q = q.in('site_id', filter.siteIds);
    if (filter.supplierId) q = q.eq('supplier_id', filter.supplierId);
    if (filter.siteId) q = q.eq('site_id', filter.siteId);
    if (filter.statusId) q = q.eq('status_id', filter.statusId);
    if (filter.pagination) {
      const from = (filter.pagination.page - 1) * filter.pagination.pageSize;
      q = q.range(from, from + filter.pagination.pageSize - 1);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => flattenContractRequest(r as Record<string, unknown>));
  }

  async statusCounts(filter: {
    counterpartyId?: string;
    siteIds?: string[];
  }): Promise<ContractStatusCounts> {
    const { data: statusRows, error: stErr } = await this.supabase
      .from('statuses')
      .select('id, code')
      .eq('entity_type', 'contract_request')
      .in('code', ['approv_omts', 'on_revision', 'concluded']);
    if (stErr) throw stErr;
    const idByCode: Record<string, string> = {};
    for (const row of statusRows ?? []) {
      const r = row as Record<string, unknown>;
      idByCode[r.code as string] = r.id as string;
    }

    if (filter.siteIds && filter.siteIds.length === 0) {
      return { approv_omts: 0, on_revision: 0, concluded: 0 };
    }

    const countByCode = async (code: string): Promise<number> => {
      const statusId = idByCode[code];
      if (!statusId) return 0;
      let q = this.supabase
        .from('contract_requests')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .eq('status_id', statusId);
      if (filter.counterpartyId) q = q.eq('counterparty_id', filter.counterpartyId);
      if (filter.siteIds) q = q.in('site_id', filter.siteIds);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const [approvOmts, onRevision, concluded] = await Promise.all([
      countByCode('approv_omts'),
      countByCode('on_revision'),
      countByCode('concluded'),
    ]);
    return { approv_omts: approvOmts, on_revision: onRevision, concluded };
  }

  async getById(id: string): Promise<ContractRequestRow | null> {
    const { data, error } = await this.supabase
      .from('contract_requests')
      .select(CR_LIST_SELECT)
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return flattenContractRequest(data as Record<string, unknown>);
  }

  async getOwnerCounterpartyId(id: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('contract_requests')
      .select('counterparty_id')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return (data.counterparty_id as string | null) ?? null;
  }

  async getStatusGate(
    id: string,
  ): Promise<{ counterpartyId: string | null; statusCode: string | null } | null> {
    const { data, error } = await this.supabase
      .from('contract_requests')
      .select('counterparty_id, status_id')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    const statusCode = await this.statusCodeById(data.status_id as string | null);
    return { counterpartyId: (data.counterparty_id as string | null) ?? null, statusCode };
  }

  async getSupplierId(id: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('contract_requests')
      .select('supplier_id')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return (data.supplier_id as string | null) ?? null;
  }

  async create(
    input: CreateContractRequestInput,
  ): Promise<{ requestId: string; requestNumber: string }> {
    const statusId = await this.getStatusId('approv_omts');
    const { data: requestNumber, error: numError } = await this.supabase.rpc(
      'generate_contract_request_number',
    );
    if (numError) throw numError;
    const { data: created, error: reqError } = await this.supabase
      .from('contract_requests')
      .insert({
        request_number: requestNumber,
        site_id: input.siteId,
        counterparty_id: input.counterpartyId,
        supplier_id: input.supplierId,
        parties_count: input.partiesCount,
        subject_type: input.subjectType,
        subject_detail: input.subjectDetail || null,
        status_id: statusId,
        created_by: input.createdBy,
      })
      .select('id')
      .single();
    if (reqError) throw reqError;
    const requestId = created.id as string;
    await this.appendStatusHistory(requestId, { event: 'created' }, input.createdBy);
    return { requestId, requestNumber: requestNumber as string };
  }

  async update(
    id: string,
    patch: UpdateContractRequestBody,
    opts: { stripCounterparty: boolean },
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};
    const body = patch as Record<string, unknown>;
    for (const [camel, snake] of Object.entries(UPDATE_FIELD_MAP)) {
      if (body[camel] !== undefined) updateData[snake] = body[camel];
    }
    if (opts.stripCounterparty) delete updateData.counterparty_id;
    if (Object.keys(updateData).length === 0) return;
    const { error } = await this.supabase.from('contract_requests').update(updateData).eq('id', id);
    if (error) throw error;
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async setContractDetails(id: string, body: ContractDetailsBody): Promise<void> {
    const updateData: Record<string, unknown> = {};
    if (body.contractNumber !== undefined) updateData.contract_number = body.contractNumber;
    if (body.contractSigningDate !== undefined) {
      updateData.contract_signing_date = body.contractSigningDate;
    }
    if (Object.keys(updateData).length === 0) return;
    const { error } = await this.supabase.from('contract_requests').update(updateData).eq('id', id);
    if (error) throw error;
  }

  async sendToRevision(id: string, targets: string[], userId: string): Promise<void> {
    const statusId = await this.getStatusId('on_revision');
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ status_id: statusId, revision_targets: targets })
      .eq('id', id);
    if (error) throw error;
    await this.appendStatusHistory(id, { event: 'revision', revisionTargets: targets }, userId);
  }

  async completeRevision(id: string, target: string, userId: string): Promise<void> {
    const { data: current, error: fetchErr } = await this.supabase
      .from('contract_requests')
      .select('revision_targets')
      .eq('id', id)
      .single();
    if (fetchErr || !current) throw new NotFoundError('ContractRequest', id);
    const currentTargets = (current.revision_targets as string[]) ?? [];
    const newTargets = currentTargets.filter((t) => t !== target);
    if (newTargets.length === 0) {
      const statusId = await this.getStatusId('approv_omts');
      const { error } = await this.supabase
        .from('contract_requests')
        .update({ status_id: statusId, revision_targets: [] })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await this.supabase
        .from('contract_requests')
        .update({ revision_targets: newTargets })
        .eq('id', id);
      if (error) throw error;
    }
    await this.appendStatusHistory(
      id,
      { event: 'revision_complete', revisionTarget: target },
      userId,
    );
  }

  async approve(id: string, userId: string): Promise<void> {
    const statusId = await this.getStatusId('approved_waiting');
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ status_id: statusId, revision_targets: [] })
      .eq('id', id);
    if (error) throw error;
    await this.appendStatusHistory(id, { event: 'approved' }, userId);
  }

  async markOriginalReceived(id: string, userId: string): Promise<void> {
    const statusId = await this.getStatusId('concluded');
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ status_id: statusId, original_received_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await this.appendStatusHistory(id, { event: 'original_received' }, userId);
  }

  async revertToPrevious(id: string, userId: string, comment?: string | null): Promise<void> {
    const { data: current, error: fetchErr } = await this.supabase
      .from('contract_requests')
      .select('status_id')
      .eq('id', id)
      .single();
    if (fetchErr || !current) throw new NotFoundError('ContractRequest', id);
    const currentCode =
      (await this.statusCodeById(current.status_id as string | null)) ?? undefined;
    const targetCode = currentCode ? CONTRACT_PREVIOUS_STATUS[currentCode] : undefined;
    if (!targetCode) throw new ValidationError('Для текущего статуса нет предыдущего этапа');

    const statusId = await this.getStatusId(targetCode);
    const { data: targetStatus } = await this.supabase
      .from('statuses')
      .select('name')
      .eq('entity_type', 'contract_request')
      .eq('code', targetCode)
      .single();
    const toStatusName = (targetStatus?.name as string | undefined) ?? targetCode;

    const updateData: Record<string, unknown> = { status_id: statusId };
    if (currentCode === 'concluded') updateData.original_received_at = null;
    if (targetCode === 'approv_omts') updateData.revision_targets = [];
    const { error } = await this.supabase.from('contract_requests').update(updateData).eq('id', id);
    if (error) throw error;

    const trimmed = comment?.trim() || null;
    await this.appendStatusHistory(
      id,
      { event: 'status_reverted', toStatusName, ...(trimmed ? { comment: trimmed } : {}) },
      userId,
    );
  }

  async reject(id: string, userId: string, comment: string): Promise<void> {
    const { data: current, error: fetchErr } = await this.supabase
      .from('contract_requests')
      .select('status_id')
      .eq('id', id)
      .single();
    if (fetchErr || !current) throw new NotFoundError('ContractRequest', id);
    const currentCode = await this.statusCodeById(current.status_id as string | null);
    if (currentCode === 'concluded' || currentCode === 'rejected') {
      throw new ValidationError('Заявку в этом статусе нельзя отклонить');
    }
    const statusId = await this.getStatusId('rejected');
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ status_id: statusId })
      .eq('id', id);
    if (error) throw error;
    await this.appendStatusHistory(id, { event: 'rejected', comment }, userId);
  }

  async assign(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('contract_requests')
      .update({ responsible_user_id: userId })
      .eq('id', id);
    if (error) throw error;
    await this.appendStatusHistory(id, { event: 'assigned' }, userId);
  }

  async listFiles(contractRequestId: string): Promise<ContractRequestRow[]> {
    const { data, error } = await this.supabase
      .from('contract_request_files')
      .select(
        'id, contract_request_id, file_name, file_key, file_size, mime_type, created_by, created_at, is_additional, is_rejected, rejected_by, rejected_at, is_signed_contract, users!contract_request_files_created_by_fkey(role, department_id, counterparties(name))',
      )
      .eq('contract_request_id', contractRequestId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => flattenContractRequestFile(r as Record<string, unknown>));
  }

  async addFile(contractRequestId: string, file: AddContractFileBody): Promise<void> {
    let isSignedContract = false;
    if (file.isSignedContract) {
      const { data: cr } = await this.supabase
        .from('contract_requests')
        .select('status_id')
        .eq('id', contractRequestId)
        .maybeSingle();
      const code = await this.statusCodeById((cr?.status_id as string | null) ?? null);
      if (code === 'approved_waiting' || code === 'concluded') isSignedContract = true;
    }
    const { error } = await this.supabase.from('contract_request_files').insert({
      contract_request_id: contractRequestId,
      file_name: file.fileName,
      file_key: file.fileKey,
      file_size: file.fileSize,
      mime_type: file.mimeType ?? null,
      created_by: file.userId,
      is_additional: file.isAdditional ?? false,
      is_signed_contract: isSignedContract,
    });
    if (error) throw error;
  }

  async getFileRejection(fileId: string): Promise<boolean | null> {
    const { data, error } = await this.supabase
      .from('contract_request_files')
      .select('is_rejected')
      .eq('id', fileId)
      .single();
    if (error || !data) return null;
    return (data.is_rejected as boolean) ?? false;
  }

  async setFileRejection(
    fileId: string,
    isRejected: boolean,
    rejectedBy: string | null,
  ): Promise<void> {
    const updateData = isRejected
      ? { is_rejected: true, rejected_by: rejectedBy, rejected_at: new Date().toISOString() }
      : { is_rejected: false, rejected_by: null, rejected_at: null };
    const { error } = await this.supabase
      .from('contract_request_files')
      .update(updateData)
      .eq('id', fileId);
    if (error) throw error;
  }

  async setSignedContract(fileId: string, isSignedContract: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('contract_request_files')
      .update({ is_signed_contract: isSignedContract })
      .eq('id', fileId);
    if (error) throw error;
  }
}
