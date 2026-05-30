/**
 * DrizzleRepository для простых справочников (Iteration 5).
 * Записи (create/update/delete/batch) — в явных db.transaction()
 * (резерв под будущие outbox/audit, принцип плана).
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  constructionSites,
  costTypes,
  documentTypes,
  statuses,
  paymentRequestFieldOptions,
} from '../../db/schema/index.js';
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
import { getPgErrorCode, PG_FOREIGN_KEY_VIOLATION } from './errors.js';

type Db = PostgresJsDatabase<typeof schema>;

function siteToDto(r: typeof constructionSites.$inferSelect): ConstructionSite {
  return { id: r.id, name: r.name, isActive: r.isActive, createdAt: r.createdAt };
}
function costToDto(r: typeof costTypes.$inferSelect): CostType {
  return { id: r.id, name: r.name, isActive: r.isActive, createdAt: r.createdAt };
}
function docToDto(r: typeof documentTypes.$inferSelect): DocumentType {
  return { id: r.id, name: r.name, category: r.category, createdAt: r.createdAt };
}
function statusToDto(r: typeof statuses.$inferSelect): Status {
  return {
    id: r.id,
    entityType: r.entityType,
    code: r.code,
    name: r.name,
    color: r.color,
    isActive: r.isActive,
    displayOrder: r.displayOrder,
    visibleRoles: r.visibleRoles,
    createdAt: r.createdAt,
  };
}
function fieldOptionToDto(r: typeof paymentRequestFieldOptions.$inferSelect): FieldOption {
  return {
    id: r.id,
    fieldCode: r.fieldCode,
    value: r.value,
    isActive: r.isActive,
    displayOrder: r.displayOrder,
    createdAt: r.createdAt,
  };
}

export class DrizzleReferenceRepository implements ReferenceRepository {
  constructor(private readonly db: Db) {}

  /* ----------------------------- Объекты строительства ----------------------------- */

  async listConstructionSites(): Promise<ConstructionSite[]> {
    const rows = await this.db
      .select()
      .from(constructionSites)
      .orderBy(desc(constructionSites.createdAt));
    return rows.map(siteToDto);
  }

  async getConstructionSite(id: string): Promise<ConstructionSite> {
    const [row] = await this.db
      .select()
      .from(constructionSites)
      .where(eq(constructionSites.id, id))
      .limit(1);
    if (!row) throw new NotFoundError('ConstructionSite', id);
    return siteToDto(row);
  }

  async createConstructionSite(body: CreateConstructionSiteBody): Promise<ConstructionSite> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(constructionSites)
        .values({ name: body.name, isActive: body.isActive ?? true })
        .returning();
      return siteToDto(row!);
    });
  }

  async updateConstructionSite(
    id: string,
    body: UpdateConstructionSiteBody,
  ): Promise<ConstructionSite> {
    const patch: Partial<typeof constructionSites.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (Object.keys(patch).length === 0) return this.getConstructionSite(id);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(constructionSites)
        .set(patch)
        .where(eq(constructionSites.id, id))
        .returning();
      if (!row) throw new NotFoundError('ConstructionSite', id);
      return siteToDto(row);
    });
  }

  async deleteConstructionSite(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      try {
        const deleted = await tx
          .delete(constructionSites)
          .where(eq(constructionSites.id, id))
          .returning({ id: constructionSites.id });
        if (deleted.length === 0) throw new NotFoundError('ConstructionSite', id);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
          throw new ForeignKeyConstraintError('ConstructionSite', 'связанные заявки');
        }
        throw err;
      }
    });
  }

  /* --------------------------------- Виды затрат --------------------------------- */

  async listCostTypes(): Promise<CostType[]> {
    const rows = await this.db.select().from(costTypes).orderBy(asc(costTypes.name));
    return rows.map(costToDto);
  }

  async createCostType(body: CreateCostTypeBody): Promise<CostType> {
    return this.db.transaction(async (tx) => {
      const values: typeof costTypes.$inferInsert = { name: body.name };
      if (body.isActive !== undefined) values.isActive = body.isActive;
      const [row] = await tx.insert(costTypes).values(values).returning();
      return costToDto(row!);
    });
  }

  async updateCostType(id: string, body: UpdateCostTypeBody): Promise<CostType> {
    const patch: Partial<typeof costTypes.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db.select().from(costTypes).where(eq(costTypes.id, id)).limit(1);
      if (!row) throw new NotFoundError('CostType', id);
      return costToDto(row);
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(costTypes).set(patch).where(eq(costTypes.id, id)).returning();
      if (!row) throw new NotFoundError('CostType', id);
      return costToDto(row);
    });
  }

  async deleteCostType(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      try {
        const deleted = await tx
          .delete(costTypes)
          .where(eq(costTypes.id, id))
          .returning({ id: costTypes.id });
        if (deleted.length === 0) throw new NotFoundError('CostType', id);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
          throw new ForeignKeyConstraintError('CostType', 'связанные заявки');
        }
        throw err;
      }
    });
  }

  async batchCreateCostTypes(names: string[]): Promise<number> {
    if (names.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      await tx.insert(costTypes).values(names.map((name) => ({ name })));
      return names.length;
    });
  }

  /* -------------------------------- Типы документов -------------------------------- */

  async listDocumentTypes(category?: string): Promise<DocumentType[]> {
    const base = this.db.select().from(documentTypes);
    const rows = category
      ? await base
          .where(eq(documentTypes.category, category))
          .orderBy(desc(documentTypes.createdAt))
      : await base.orderBy(desc(documentTypes.createdAt));
    return rows.map(docToDto);
  }

  async createDocumentType(body: CreateDocumentTypeBody): Promise<DocumentType> {
    return this.db.transaction(async (tx) => {
      const values: typeof documentTypes.$inferInsert = { name: body.name };
      if (body.category) values.category = body.category;
      const [row] = await tx.insert(documentTypes).values(values).returning();
      return docToDto(row!);
    });
  }

  async updateDocumentType(id: string, body: UpdateDocumentTypeBody): Promise<DocumentType> {
    const patch: Partial<typeof documentTypes.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.category !== undefined) patch.category = body.category;
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.id, id))
        .limit(1);
      if (!row) throw new NotFoundError('DocumentType', id);
      return docToDto(row);
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(documentTypes)
        .set(patch)
        .where(eq(documentTypes.id, id))
        .returning();
      if (!row) throw new NotFoundError('DocumentType', id);
      return docToDto(row);
    });
  }

  async deleteDocumentType(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      try {
        const deleted = await tx
          .delete(documentTypes)
          .where(eq(documentTypes.id, id))
          .returning({ id: documentTypes.id });
        if (deleted.length === 0) throw new NotFoundError('DocumentType', id);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
          throw new ForeignKeyConstraintError('DocumentType', 'связанные документы');
        }
        throw err;
      }
    });
  }

  /* ----------------------------------- Статусы ----------------------------------- */

  async listStatuses(entityType: string): Promise<Status[]> {
    const rows = await this.db
      .select()
      .from(statuses)
      .where(eq(statuses.entityType, entityType))
      .orderBy(asc(statuses.displayOrder));
    return rows.map(statusToDto);
  }

  async createStatus(body: CreateStatusBody): Promise<Status> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(statuses)
        .values({
          entityType: body.entityType,
          code: body.code,
          name: body.name,
          color: body.color ?? null,
          isActive: body.isActive ?? true,
          displayOrder: body.displayOrder ?? 0,
          visibleRoles: body.visibleRoles ?? [],
        })
        .returning();
      return statusToDto(row!);
    });
  }

  async updateStatus(id: string, body: UpdateStatusBody): Promise<Status> {
    const patch: Partial<typeof statuses.$inferInsert> = {};
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.color !== undefined) patch.color = body.color;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder;
    if (body.visibleRoles !== undefined) patch.visibleRoles = body.visibleRoles;
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db.select().from(statuses).where(eq(statuses.id, id)).limit(1);
      if (!row) throw new NotFoundError('Status', id);
      return statusToDto(row);
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(statuses).set(patch).where(eq(statuses.id, id)).returning();
      if (!row) throw new NotFoundError('Status', id);
      return statusToDto(row);
    });
  }

  async deleteStatus(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      try {
        const deleted = await tx
          .delete(statuses)
          .where(eq(statuses.id, id))
          .returning({ id: statuses.id });
        if (deleted.length === 0) throw new NotFoundError('Status', id);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
          throw new ForeignKeyConstraintError('Status', 'связанные заявки');
        }
        throw err;
      }
    });
  }

  /* --------------------------------- Опции полей --------------------------------- */

  async listFieldOptions(fieldCode?: string): Promise<FieldOption[]> {
    const base = this.db.select().from(paymentRequestFieldOptions);
    const rows = fieldCode
      ? await base
          .where(eq(paymentRequestFieldOptions.fieldCode, fieldCode))
          .orderBy(
            asc(paymentRequestFieldOptions.fieldCode),
            asc(paymentRequestFieldOptions.displayOrder),
          )
      : await base.orderBy(
          asc(paymentRequestFieldOptions.fieldCode),
          asc(paymentRequestFieldOptions.displayOrder),
        );
    return rows.map(fieldOptionToDto);
  }

  async createFieldOption(body: CreateFieldOptionBody): Promise<FieldOption> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(paymentRequestFieldOptions)
        .values({
          fieldCode: body.fieldCode,
          value: body.value,
          isActive: body.isActive ?? true,
          displayOrder: body.displayOrder ?? 0,
        })
        .returning();
      return fieldOptionToDto(row!);
    });
  }

  async updateFieldOption(id: string, body: UpdateFieldOptionBody): Promise<FieldOption> {
    const patch: Partial<typeof paymentRequestFieldOptions.$inferInsert> = {};
    if (body.value !== undefined) patch.value = body.value;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.displayOrder !== undefined) patch.displayOrder = body.displayOrder;
    if (Object.keys(patch).length === 0) {
      const [row] = await this.db
        .select()
        .from(paymentRequestFieldOptions)
        .where(eq(paymentRequestFieldOptions.id, id))
        .limit(1);
      if (!row) throw new NotFoundError('FieldOption', id);
      return fieldOptionToDto(row);
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentRequestFieldOptions)
        .set(patch)
        .where(eq(paymentRequestFieldOptions.id, id))
        .returning();
      if (!row) throw new NotFoundError('FieldOption', id);
      return fieldOptionToDto(row);
    });
  }

  async deleteFieldOption(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      try {
        const deleted = await tx
          .delete(paymentRequestFieldOptions)
          .where(eq(paymentRequestFieldOptions.id, id))
          .returning({ id: paymentRequestFieldOptions.id });
        if (deleted.length === 0) throw new NotFoundError('FieldOption', id);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        if (getPgErrorCode(err) === PG_FOREIGN_KEY_VIOLATION) {
          throw new ForeignKeyConstraintError('FieldOption', 'связанные заявки');
        }
        throw err;
      }
    });
  }
}
