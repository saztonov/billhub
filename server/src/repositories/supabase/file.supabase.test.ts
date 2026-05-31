/**
 * Unit-тесты SupabaseFileRepository (Phase 3) на FakeSupabase.
 * Проверяют выбор таблицы по entityType, маппинг FK + доп. полей, удаление по (FK, file_key).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseFileRepository } from './file.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseFileRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

describe('SupabaseFileRepository', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('payment_request_files: FK + доп. поля', async () => {
    const res = await s.repo.createFileRecord({
      entityType: 'payment_request_files',
      entityId: 'pr1',
      fileName: 'invoice.pdf',
      fileKey: 'cp/PR-1/123_invoice.pdf',
      fileSize: 1000,
      mimeType: 'application/pdf',
      createdBy: 'u1',
      documentTypeId: 'dt1',
      pageCount: 3,
      isResubmit: true,
      isAdditional: false,
    });
    expect(res.fileKey).toBe('cp/PR-1/123_invoice.pdf');
    const row = s.fake.tableRows('payment_request_files')[0]!;
    expect(row.payment_request_id).toBe('pr1');
    expect(row.document_type_id).toBe('dt1');
    expect(row.page_count).toBe(3);
    expect(row.is_resubmit).toBe(true);
    expect(row.is_additional).toBe(false);
    expect(row.created_by).toBe('u1');
  });

  it('founding_document_files: FK + comment', async () => {
    await s.repo.createFileRecord({
      entityType: 'founding_document_files',
      entityId: 'sfd1',
      fileName: 'ustav.pdf',
      fileKey: 'founding-docs/sfd1/1_ustav.pdf',
      fileSize: 2000,
      mimeType: 'application/pdf',
      createdBy: 'u2',
      comment: 'Учредительный документ',
    });
    const row = s.fake.tableRows('founding_document_files')[0]!;
    expect(row.supplier_founding_document_id).toBe('sfd1');
    expect(row.comment).toBe('Учредительный документ');
    // доп. поля payment_request_files не попадают
    expect(row.document_type_id).toBeUndefined();
  });

  it('contract_request_files: FK + is_additional; payment-поля не добавляются', async () => {
    await s.repo.createFileRecord({
      entityType: 'contract_request_files',
      entityId: 'cr1',
      fileName: 'doc.pdf',
      fileKey: 'cp/contract/cr1/1_doc.pdf',
      fileSize: 500,
      mimeType: 'application/pdf',
      createdBy: 'u3',
      isAdditional: true,
      documentTypeId: 'ignored',
      pageCount: 9,
    });
    const row = s.fake.tableRows('contract_request_files')[0]!;
    expect(row.contract_request_id).toBe('cr1');
    expect(row.is_additional).toBe(true);
    expect(row.document_type_id).toBeUndefined();
    expect(row.page_count).toBeUndefined();
  });

  it('approval_decision_files / payment_payment_files: только базовые поля', async () => {
    await s.repo.createFileRecord({
      entityType: 'approval_decision_files',
      entityId: 'ad1',
      fileName: 'd.pdf',
      fileKey: 'approval-decisions/ad1/1_d.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      createdBy: 'u4',
    });
    expect(s.fake.tableRows('approval_decision_files')[0]!.approval_decision_id).toBe('ad1');

    await s.repo.createFileRecord({
      entityType: 'payment_payment_files',
      entityId: 'pp1',
      fileName: 'p.pdf',
      fileKey: 'cp/payment/pp1/1_p.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
      createdBy: 'u5',
    });
    expect(s.fake.tableRows('payment_payment_files')[0]!.payment_payment_id).toBe('pp1');
  });

  it('deleteFileRecord удаляет по (FK, file_key)', async () => {
    await s.repo.createFileRecord({
      entityType: 'payment_request_files',
      entityId: 'pr1',
      fileName: 'a.pdf',
      fileKey: 'key-a',
      fileSize: 1,
      mimeType: 'application/pdf',
      createdBy: 'u1',
      documentTypeId: 'dt1',
    });
    await s.repo.createFileRecord({
      entityType: 'payment_request_files',
      entityId: 'pr1',
      fileName: 'b.pdf',
      fileKey: 'key-b',
      fileSize: 1,
      mimeType: 'application/pdf',
      createdBy: 'u1',
      documentTypeId: 'dt1',
    });
    await s.repo.deleteFileRecord('payment_request_files', 'pr1', 'key-a');
    const rows = s.fake.tableRows('payment_request_files');
    expect(rows.length).toBe(1);
    expect(rows[0]!.file_key).toBe('key-b');
  });
});
