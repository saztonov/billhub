/**
 * ReferenceRepository — доступ к простым справочникам:
 * объекты строительства, виды затрат, типы документов, статусы.
 * Strangler Fig: реализации — SupabaseRepository и DrizzleRepository.
 */
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
} from '../schemas/reference.js';

export interface ReferenceRepository {
  /* --- Объекты строительства --- */
  listConstructionSites(): Promise<ConstructionSite[]>;
  getConstructionSite(id: string): Promise<ConstructionSite>;
  createConstructionSite(body: CreateConstructionSiteBody): Promise<ConstructionSite>;
  updateConstructionSite(id: string, body: UpdateConstructionSiteBody): Promise<ConstructionSite>;
  deleteConstructionSite(id: string): Promise<void>;

  /* --- Виды затрат --- */
  listCostTypes(): Promise<CostType[]>;
  createCostType(body: CreateCostTypeBody): Promise<CostType>;
  updateCostType(id: string, body: UpdateCostTypeBody): Promise<CostType>;
  deleteCostType(id: string): Promise<void>;
  /** Пакетный импорт по именам; возвращает число созданных. */
  batchCreateCostTypes(names: string[]): Promise<number>;

  /* --- Типы документов --- */
  listDocumentTypes(category?: string): Promise<DocumentType[]>;
  createDocumentType(body: CreateDocumentTypeBody): Promise<DocumentType>;
  updateDocumentType(id: string, body: UpdateDocumentTypeBody): Promise<DocumentType>;
  deleteDocumentType(id: string): Promise<void>;

  /* --- Статусы --- */
  listStatuses(entityType: string): Promise<Status[]>;
  createStatus(body: CreateStatusBody): Promise<Status>;
  updateStatus(id: string, body: UpdateStatusBody): Promise<Status>;
  deleteStatus(id: string): Promise<void>;
}
