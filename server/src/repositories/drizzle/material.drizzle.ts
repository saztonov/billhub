/**
 * DrizzleMaterialRepository (Iteration 5). Распознанные материалы: явные join'ы вместо embeds,
 * та же JS-агрегация (Number() по numeric-строкам — как в роуте). updateEstimate — в транзакции.
 */
import { and, asc, desc, eq, getTableColumns, gte, inArray, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema/index.js';
import {
  recognizedMaterials,
  materialsDictionary,
  paymentRequests,
  paymentRequestFiles,
  counterparties,
  suppliers,
  constructionSites,
  costTypes,
} from '../../db/schema/index.js';
import type { MaterialRepository, MaterialFilter, Row } from '../material.repository.js';

const INVOICE_DOC_TYPE_ID = 'c3c0b242-8a0c-4e20-b9ad-363ebf462a5b';
type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleMaterialRepository implements MaterialRepository {
  constructor(private readonly db: Db) {}

  async getRequestInfo(paymentRequestId: string): Promise<Row | null> {
    const [row] = await this.db
      .select({
        request_number: paymentRequests.requestNumber,
        approved_at: paymentRequests.approvedAt,
        cost_type_id: paymentRequests.costTypeId,
        materials_verification: paymentRequests.materialsVerification,
        counterparty_name: counterparties.name,
        supplier_name: suppliers.name,
        site_name: constructionSites.name,
        cost_type_name: costTypes.name,
      })
      .from(paymentRequests)
      .leftJoin(counterparties, eq(counterparties.id, paymentRequests.counterpartyId))
      .leftJoin(suppliers, eq(suppliers.id, paymentRequests.supplierId))
      .leftJoin(constructionSites, eq(constructionSites.id, paymentRequests.siteId))
      .leftJoin(costTypes, eq(costTypes.id, paymentRequests.costTypeId))
      .where(eq(paymentRequests.id, paymentRequestId))
      .limit(1);
    if (!row) return null;
    return {
      request_number: row.request_number,
      counterparty_name: row.counterparty_name ?? null,
      supplier_name: row.supplier_name ?? null,
      site_name: row.site_name ?? null,
      approved_at: row.approved_at,
      cost_type_id: row.cost_type_id,
      cost_type_name: row.cost_type_name ?? null,
      materials_verification: row.materials_verification,
    };
  }

  async listDictionary(): Promise<Row[]> {
    return (await this.db
      .select({
        id: materialsDictionary.id,
        name: materialsDictionary.name,
        unit: materialsDictionary.unit,
      })
      .from(materialsDictionary)
      .orderBy(asc(materialsDictionary.name))) as Row[];
  }

  async listRequests(): Promise<Row[]> {
    const allMat = await this.db
      .select({ prId: recognizedMaterials.paymentRequestId, amount: recognizedMaterials.amount })
      .from(recognizedMaterials);
    const uniqueIds = [...new Set(allMat.map((r) => r.prId))];
    if (uniqueIds.length === 0) return [];

    const countMap: Record<string, { count: number; total: number }> = {};
    for (const r of allMat) {
      if (!countMap[r.prId]) countMap[r.prId] = { count: 0, total: 0 };
      countMap[r.prId]!.count++;
      countMap[r.prId]!.total += Number(r.amount ?? 0);
    }

    const filesRows = await this.db
      .select({ prId: paymentRequestFiles.paymentRequestId })
      .from(paymentRequestFiles)
      .where(
        and(
          inArray(paymentRequestFiles.paymentRequestId, uniqueIds),
          eq(paymentRequestFiles.documentTypeId, INVOICE_DOC_TYPE_ID),
        ),
      );
    const invoicesCountMap: Record<string, number> = {};
    for (const f of filesRows) {
      invoicesCountMap[f.prId] = (invoicesCountMap[f.prId] ?? 0) + 1;
    }

    const prRows = await this.db
      .select({
        id: paymentRequests.id,
        requestNumber: paymentRequests.requestNumber,
        approvedAt: paymentRequests.approvedAt,
        materialsVerification: paymentRequests.materialsVerification,
        counterpartyName: counterparties.name,
        supplierName: suppliers.name,
        siteName: constructionSites.name,
      })
      .from(paymentRequests)
      .leftJoin(counterparties, eq(counterparties.id, paymentRequests.counterpartyId))
      .leftJoin(suppliers, eq(suppliers.id, paymentRequests.supplierId))
      .leftJoin(constructionSites, eq(constructionSites.id, paymentRequests.siteId))
      .where(inArray(paymentRequests.id, uniqueIds))
      .orderBy(desc(paymentRequests.approvedAt));

    return prRows.map((row) => ({
      paymentRequestId: row.id,
      requestNumber: row.requestNumber,
      counterpartyName: row.counterpartyName ?? '',
      supplierName: row.supplierName ?? '',
      approvedAt: row.approvedAt,
      siteName: row.siteName ?? '',
      itemsCount: countMap[row.id]?.count ?? 0,
      totalAmount: countMap[row.id]?.total ?? 0,
      invoicesCount: invoicesCountMap[row.id] ?? 0,
      materialsVerification: row.materialsVerification ?? null,
    }));
  }

  async listRecognized(paymentRequestId: string): Promise<Row[]> {
    const rows = await this.db
      .select({
        ...getTableColumns(recognizedMaterials),
        material_name: materialsDictionary.name,
        material_unit: materialsDictionary.unit,
      })
      .from(recognizedMaterials)
      .leftJoin(materialsDictionary, eq(materialsDictionary.id, recognizedMaterials.materialId))
      .where(eq(recognizedMaterials.paymentRequestId, paymentRequestId))
      .orderBy(asc(recognizedMaterials.position));
    return rows.map((r) => ({
      ...r,
      material_name: r.material_name ?? null,
      material_unit: r.material_unit ?? null,
    })) as Row[];
  }

  async updateEstimate(id: string, estimateQuantity: number | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(recognizedMaterials)
        .set({ estimateQuantity })
        .where(eq(recognizedMaterials.id, id));
    });
  }

  async getSummary(filter: MaterialFilter): Promise<Row[]> {
    const conds: SQL[] = [];
    if (filter.counterpartyId)
      conds.push(eq(paymentRequests.counterpartyId, filter.counterpartyId));
    if (filter.supplierId) conds.push(eq(paymentRequests.supplierId, filter.supplierId));
    if (filter.siteId) conds.push(eq(paymentRequests.siteId, filter.siteId));
    if (filter.dateFrom) conds.push(gte(paymentRequests.approvedAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(paymentRequests.approvedAt, filter.dateTo));

    const data = await this.db
      .select({
        materialId: recognizedMaterials.materialId,
        quantity: recognizedMaterials.quantity,
        amount: recognizedMaterials.amount,
        estimateQuantity: recognizedMaterials.estimateQuantity,
        name: materialsDictionary.name,
        unit: materialsDictionary.unit,
      })
      .from(recognizedMaterials)
      .innerJoin(paymentRequests, eq(paymentRequests.id, recognizedMaterials.paymentRequestId))
      .innerJoin(materialsDictionary, eq(materialsDictionary.id, recognizedMaterials.materialId))
      .where(conds.length ? and(...conds) : undefined);

    const grouped: Record<
      string,
      {
        materialId: string;
        materialName: string;
        materialUnit: string | null;
        totalQuantity: number;
        totalAmount: number;
        totalEstimateQuantity: number;
      }
    > = {};
    for (const r of data) {
      const matId = r.materialId;
      if (!grouped[matId]) {
        grouped[matId] = {
          materialId: matId,
          materialName: r.name,
          materialUnit: r.unit ?? null,
          totalQuantity: 0,
          totalAmount: 0,
          totalEstimateQuantity: 0,
        };
      }
      grouped[matId]!.totalQuantity += Number(r.quantity ?? 0);
      grouped[matId]!.totalAmount += Number(r.amount ?? 0);
      grouped[matId]!.totalEstimateQuantity += Number(r.estimateQuantity ?? 0);
    }

    const summary = Object.values(grouped).map((row) => ({
      ...row,
      averagePrice: row.totalQuantity > 0 ? row.totalAmount / row.totalQuantity : 0,
    }));
    summary.sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'));
    return summary;
  }

  async getHierarchicalSummary(filter: MaterialFilter): Promise<Row[]> {
    const conds: SQL[] = [];
    if (filter.counterpartyId)
      conds.push(eq(paymentRequests.counterpartyId, filter.counterpartyId));
    if (filter.supplierId) conds.push(eq(paymentRequests.supplierId, filter.supplierId));
    if (filter.siteId) conds.push(eq(paymentRequests.siteId, filter.siteId));
    if (filter.costTypeId) conds.push(eq(paymentRequests.costTypeId, filter.costTypeId));
    if (filter.dateFrom) conds.push(gte(paymentRequests.approvedAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(paymentRequests.approvedAt, filter.dateTo));

    const data = await this.db
      .select({
        materialId: recognizedMaterials.materialId,
        quantity: recognizedMaterials.quantity,
        price: recognizedMaterials.price,
        amount: recognizedMaterials.amount,
        estimateQuantity: recognizedMaterials.estimateQuantity,
        costTypeId: paymentRequests.costTypeId,
        siteId: paymentRequests.siteId,
        counterpartyId: paymentRequests.counterpartyId,
        name: materialsDictionary.name,
        unit: materialsDictionary.unit,
        costTypeName: costTypes.name,
        siteName: constructionSites.name,
        counterpartyName: counterparties.name,
      })
      .from(recognizedMaterials)
      .innerJoin(paymentRequests, eq(paymentRequests.id, recognizedMaterials.paymentRequestId))
      .innerJoin(materialsDictionary, eq(materialsDictionary.id, recognizedMaterials.materialId))
      .leftJoin(counterparties, eq(counterparties.id, paymentRequests.counterpartyId))
      .leftJoin(constructionSites, eq(constructionSites.id, paymentRequests.siteId))
      .leftJoin(costTypes, eq(costTypes.id, paymentRequests.costTypeId))
      .where(conds.length ? and(...conds) : undefined);

    return data.map((row) => ({
      materialId: row.materialId,
      materialName: row.name,
      materialUnit: row.unit,
      quantity: Number(row.quantity ?? 0),
      price: Number(row.price ?? 0),
      amount: Number(row.amount ?? 0),
      estimateQuantity: row.estimateQuantity != null ? Number(row.estimateQuantity) : null,
      costTypeId: row.costTypeId,
      costTypeName: row.costTypeName ?? null,
      siteId: row.siteId,
      siteName: row.siteName ?? '',
      counterpartyId: row.counterpartyId,
      counterpartyName: row.counterpartyName ?? '',
    }));
  }

  async listInvoiceFiles(paymentRequestId: string): Promise<Row[]> {
    return (await this.db
      .select({
        id: paymentRequestFiles.id,
        file_key: paymentRequestFiles.fileKey,
        file_name: paymentRequestFiles.fileName,
        mime_type: paymentRequestFiles.mimeType,
      })
      .from(paymentRequestFiles)
      .where(
        and(
          eq(paymentRequestFiles.paymentRequestId, paymentRequestId),
          eq(paymentRequestFiles.documentTypeId, INVOICE_DOC_TYPE_ID),
        ),
      )) as Row[];
  }
}
