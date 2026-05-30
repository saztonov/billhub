/**
 * SupabaseRepository для простых справочников (Strangler Fig, rollback-инструмент).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceRepository } from '../reference.repository.js';
import type {
  ConstructionSite,
  CreateConstructionSiteBody,
  UpdateConstructionSiteBody,
  CostType,
  CreateCostTypeBody,
  UpdateCostTypeBody,
  DocumentType,
  CreateDocumentTypeBody,
  UpdateDocumentTypeBody,
  Status,
  CreateStatusBody,
  UpdateStatusBody,
  FieldOption,
  CreateFieldOptionBody,
  UpdateFieldOptionBody,
} from '../../schemas/reference.js';
import { NotFoundError, ForeignKeyConstraintError } from '../types.js';

const SITE_FIELDS = 'id, name, is_active, created_at';
const COST_FIELDS = 'id, name, is_active, created_at';
const DOC_FIELDS = 'id, name, category, created_at';
const STATUS_FIELDS =
  'id, entity_type, code, name, color, is_active, display_order, visible_roles, created_at';
const FIELD_OPTION_FIELDS = 'id, field_code, value, is_active, display_order, created_at';

interface FieldOptionRow {
  id: string;
  field_code: string;
  value: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
}
function fieldOptionToDto(r: FieldOptionRow): FieldOption {
  return {
    id: r.id,
    fieldCode: r.field_code,
    value: r.value,
    isActive: r.is_active,
    displayOrder: r.display_order,
    createdAt: r.created_at,
  };
}

interface SiteRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}
interface DocRow {
  id: string;
  name: string;
  category: string;
  created_at: string;
}
interface StatusRow {
  id: string;
  entity_type: string;
  code: string;
  name: string;
  color: string | null;
  is_active: boolean;
  display_order: number;
  visible_roles: string[] | null;
  created_at: string;
}

function siteToDto(r: SiteRow): ConstructionSite {
  return { id: r.id, name: r.name, isActive: r.is_active, createdAt: r.created_at };
}
function costToDto(r: SiteRow): CostType {
  return { id: r.id, name: r.name, isActive: r.is_active, createdAt: r.created_at };
}
function docToDto(r: DocRow): DocumentType {
  return { id: r.id, name: r.name, category: r.category, createdAt: r.created_at };
}
function statusToDto(r: StatusRow): Status {
  return {
    id: r.id,
    entityType: r.entity_type,
    code: r.code,
    name: r.name,
    color: r.color,
    isActive: r.is_active,
    displayOrder: r.display_order,
    visibleRoles: r.visible_roles ?? [],
    createdAt: r.created_at,
  };
}

function code(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

export class SupabaseReferenceRepository implements ReferenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /* ----------------------------- Объекты строительства ----------------------------- */

  async listConstructionSites(): Promise<ConstructionSite[]> {
    const { data, error } = await this.supabase
      .from('construction_sites')
      .select(SITE_FIELDS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as SiteRow[]).map(siteToDto);
  }

  async getConstructionSite(id: string): Promise<ConstructionSite> {
    const { data, error } = await this.supabase
      .from('construction_sites')
      .select(SITE_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('ConstructionSite', id);
    return siteToDto(data as SiteRow);
  }

  async createConstructionSite(body: CreateConstructionSiteBody): Promise<ConstructionSite> {
    const { data, error } = await this.supabase
      .from('construction_sites')
      .insert({ name: body.name, is_active: body.isActive ?? true })
      .select(SITE_FIELDS)
      .single();
    if (error) throw error;
    return siteToDto(data as SiteRow);
  }

  async updateConstructionSite(
    id: string,
    body: UpdateConstructionSiteBody,
  ): Promise<ConstructionSite> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const { data, error } = await this.supabase
      .from('construction_sites')
      .update(patch)
      .eq('id', id)
      .select(SITE_FIELDS)
      .single();
    if (error) {
      if (code(error) === 'PGRST116') throw new NotFoundError('ConstructionSite', id);
      throw error;
    }
    return siteToDto(data as SiteRow);
  }

  async deleteConstructionSite(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('construction_sites')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if (code(error) === '23503') {
        throw new ForeignKeyConstraintError('ConstructionSite', 'связанные заявки');
      }
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('ConstructionSite', id);
  }

  /* --------------------------------- Виды затрат --------------------------------- */

  async listCostTypes(): Promise<CostType[]> {
    const { data, error } = await this.supabase
      .from('cost_types')
      .select(COST_FIELDS)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data as SiteRow[]).map(costToDto);
  }

  async createCostType(body: CreateCostTypeBody): Promise<CostType> {
    const insert: Record<string, unknown> = { name: body.name };
    if (body.isActive !== undefined) insert.is_active = body.isActive;
    const { data, error } = await this.supabase
      .from('cost_types')
      .insert(insert)
      .select(COST_FIELDS)
      .single();
    if (error) throw error;
    return costToDto(data as SiteRow);
  }

  async updateCostType(id: string, body: UpdateCostTypeBody): Promise<CostType> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const { data, error } = await this.supabase
      .from('cost_types')
      .update(patch)
      .eq('id', id)
      .select(COST_FIELDS)
      .single();
    if (error) {
      if (code(error) === 'PGRST116') throw new NotFoundError('CostType', id);
      throw error;
    }
    return costToDto(data as SiteRow);
  }

  async deleteCostType(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('cost_types')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if (code(error) === '23503')
        throw new ForeignKeyConstraintError('CostType', 'связанные заявки');
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('CostType', id);
  }

  async batchCreateCostTypes(names: string[]): Promise<number> {
    const BATCH_SIZE = 20;
    let created = 0;
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const batch = names.slice(i, i + BATCH_SIZE).map((name) => ({ name }));
      const { error } = await this.supabase.from('cost_types').insert(batch);
      if (error) throw error;
      created += batch.length;
    }
    return created;
  }

  /* -------------------------------- Типы документов -------------------------------- */

  async listDocumentTypes(category?: string): Promise<DocumentType[]> {
    let query = this.supabase.from('document_types').select(DOC_FIELDS);
    if (category) query = query.eq('category', category);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DocRow[]).map(docToDto);
  }

  async createDocumentType(body: CreateDocumentTypeBody): Promise<DocumentType> {
    const insert: Record<string, unknown> = { name: body.name };
    if (body.category) insert.category = body.category;
    const { data, error } = await this.supabase
      .from('document_types')
      .insert(insert)
      .select(DOC_FIELDS)
      .single();
    if (error) throw error;
    return docToDto(data as DocRow);
  }

  async updateDocumentType(id: string, body: UpdateDocumentTypeBody): Promise<DocumentType> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.category !== undefined) patch.category = body.category;
    const { data, error } = await this.supabase
      .from('document_types')
      .update(patch)
      .eq('id', id)
      .select(DOC_FIELDS)
      .single();
    if (error) {
      if (code(error) === 'PGRST116') throw new NotFoundError('DocumentType', id);
      throw error;
    }
    return docToDto(data as DocRow);
  }

  async deleteDocumentType(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('document_types')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if (code(error) === '23503') {
        throw new ForeignKeyConstraintError('DocumentType', 'связанные документы');
      }
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('DocumentType', id);
  }

  /* ----------------------------------- Статусы ----------------------------------- */

  async listStatuses(entityType: string): Promise<Status[]> {
    const { data, error } = await this.supabase
      .from('statuses')
      .select(STATUS_FIELDS)
      .eq('entity_type', entityType)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return (data as StatusRow[]).map(statusToDto);
  }

  async createStatus(body: CreateStatusBody): Promise<Status> {
    const { data, error } = await this.supabase
      .from('statuses')
      .insert({
        entity_type: body.entityType,
        code: body.code,
        name: body.name,
        color: body.color ?? null,
        is_active: body.isActive ?? true,
        display_order: body.displayOrder ?? 0,
        visible_roles: body.visibleRoles ?? [],
      })
      .select(STATUS_FIELDS)
      .single();
    if (error) throw error;
    return statusToDto(data as StatusRow);
  }

  async updateStatus(id: string, body: UpdateStatusBody): Promise<Status> {
    const patch: Record<string, unknown> = {};
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.color !== undefined) patch.color = body.color;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (body.displayOrder !== undefined) patch.display_order = body.displayOrder;
    if (body.visibleRoles !== undefined) patch.visible_roles = body.visibleRoles;
    const { data, error } = await this.supabase
      .from('statuses')
      .update(patch)
      .eq('id', id)
      .select(STATUS_FIELDS)
      .single();
    if (error) {
      if (code(error) === 'PGRST116') throw new NotFoundError('Status', id);
      throw error;
    }
    return statusToDto(data as StatusRow);
  }

  async deleteStatus(id: string): Promise<void> {
    const { data, error } = await this.supabase.from('statuses').delete().eq('id', id).select('id');
    if (error) {
      if (code(error) === '23503')
        throw new ForeignKeyConstraintError('Status', 'связанные заявки');
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('Status', id);
  }

  /* --------------------------------- Опции полей --------------------------------- */

  async listFieldOptions(fieldCode?: string): Promise<FieldOption[]> {
    let query = this.supabase
      .from('payment_request_field_options')
      .select(FIELD_OPTION_FIELDS)
      .order('field_code', { ascending: true })
      .order('display_order', { ascending: true });
    if (fieldCode) query = query.eq('field_code', fieldCode);
    const { data, error } = await query;
    if (error) throw error;
    return (data as FieldOptionRow[]).map(fieldOptionToDto);
  }

  async createFieldOption(body: CreateFieldOptionBody): Promise<FieldOption> {
    const { data, error } = await this.supabase
      .from('payment_request_field_options')
      .insert({
        field_code: body.fieldCode,
        value: body.value,
        is_active: body.isActive ?? true,
        display_order: body.displayOrder ?? 0,
      })
      .select(FIELD_OPTION_FIELDS)
      .single();
    if (error) throw error;
    return fieldOptionToDto(data as FieldOptionRow);
  }

  async updateFieldOption(id: string, body: UpdateFieldOptionBody): Promise<FieldOption> {
    const patch: Record<string, unknown> = {};
    if (body.value !== undefined) patch.value = body.value;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (body.displayOrder !== undefined) patch.display_order = body.displayOrder;
    const { data, error } = await this.supabase
      .from('payment_request_field_options')
      .update(patch)
      .eq('id', id)
      .select(FIELD_OPTION_FIELDS)
      .single();
    if (error) {
      if (code(error) === 'PGRST116') throw new NotFoundError('FieldOption', id);
      throw error;
    }
    return fieldOptionToDto(data as FieldOptionRow);
  }

  async deleteFieldOption(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('payment_request_field_options')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      if (code(error) === '23503') {
        throw new ForeignKeyConstraintError('FieldOption', 'связанные заявки');
      }
      throw error;
    }
    if (!data || data.length === 0) throw new NotFoundError('FieldOption', id);
  }
}
