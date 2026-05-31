/**
 * Unit-тесты SupabaseFoundingDocumentRepository (Phase 8d) на FakeSupabase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeSupabase } from '../../test/fake-supabase.js';
import { SupabaseFoundingDocumentRepository } from './founding-document.supabase.js';

function setup() {
  const fake = new FakeSupabase();
  const repo = new SupabaseFoundingDocumentRepository(fake as unknown as SupabaseClient);
  return { fake, repo };
}

describe('SupabaseFoundingDocumentRepository.getTable', () => {
  it('строит таблицу: типы + статус документа + счётчик файлов + ФИО проверившего', async () => {
    const { fake, repo } = setup();
    fake.seed('document_types', [
      { id: 't1', name: 'Устав', category: 'founding', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'ИНН', category: 'founding', created_at: '2026-01-02T00:00:00Z' },
    ]);
    fake.seed('supplier_founding_documents', [
      {
        id: 'd1',
        supplier_id: 'sup1',
        founding_document_type_id: 't1',
        is_available: true,
        checked_by: 'u1',
        checked_at: '2026-02-01T00:00:00Z',
        comment: 'ок',
      },
    ]);
    fake.seed('founding_document_files', [
      { id: 'f1', supplier_founding_document_id: 'd1' },
      { id: 'f2', supplier_founding_document_id: 'd1' },
    ]);
    fake.seed('users', [{ id: 'u1', full_name: 'Иванов И.И.' }]);

    const res = await repo.getTable('sup1');
    expect(res.length).toBe(2);
    const t1 = res.find((r) => r.type_id === 't1')!;
    expect(t1.type_name).toBe('Устав');
    expect(t1.doc_id).toBe('d1');
    expect(t1.is_available).toBe(true);
    expect(t1.checked_by_name).toBe('Иванов И.И.');
    expect(t1.file_count).toBe(2);
    expect(t1.comment).toBe('ок');
    const t2 = res.find((r) => r.type_id === 't2')!;
    expect(t2.doc_id).toBeNull();
    expect(t2.is_available).toBe(false);
    expect(t2.file_count).toBe(0);
    expect(t2.comment).toBe('');
  });

  it('нет типов founding → []', async () => {
    const { repo } = setup();
    expect(await repo.getTable('sup1')).toEqual([]);
  });
});

describe('SupabaseFoundingDocumentRepository.upsert', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('создаёт запись, если её нет (created)', async () => {
    const res = await s.repo.upsert('sup1', 't1', { isAvailable: true }, 'u1');
    expect(res.created).toBe(true);
    const row = s.fake.tableRows('supplier_founding_documents')[0]!;
    expect(row.supplier_id).toBe('sup1');
    expect(row.is_available).toBe(true);
    expect(row.checked_by).toBe('u1');
    expect(row.checked_at).toBeTruthy();
  });

  it('обновляет существующую (updated); isAvailable=false снимает checked_by/at', async () => {
    s.fake.seed('supplier_founding_documents', [
      {
        id: 'd1',
        supplier_id: 'sup1',
        founding_document_type_id: 't1',
        is_available: true,
        checked_by: 'u1',
        checked_at: '2026-02-01T00:00:00Z',
        comment: '',
      },
    ]);
    const res = await s.repo.upsert('sup1', 't1', { isAvailable: false, comment: 'нет' }, 'u9');
    expect(res.updated).toBe(true);
    const row = s.fake.tableRows('supplier_founding_documents')[0]!;
    expect(row.is_available).toBe(false);
    expect(row.checked_by).toBeNull();
    expect(row.checked_at).toBeNull();
    expect(row.comment).toBe('нет');
  });
});

describe('SupabaseFoundingDocumentRepository — comment + files', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('getGeneralComment: найден → comment; не найден → null', async () => {
    s.fake.seed('suppliers', [
      { id: 'sup1', founding_documents_comment: 'общий коммент', inn: '1' },
    ]);
    expect(await s.repo.getGeneralComment('sup1')).toEqual({ comment: 'общий коммент' });
    expect(await s.repo.getGeneralComment('missing')).toBeNull();
  });

  it('setGeneralComment обновляет поле', async () => {
    s.fake.seed('suppliers', [{ id: 'sup1', founding_documents_comment: null, inn: '1' }]);
    await s.repo.setGeneralComment('sup1', 'новый');
    expect(s.fake.tableRows('suppliers')[0]!.founding_documents_comment).toBe('новый');
  });

  it('listFiles: нет записи документа → []; иначе файлы с created_by_name', async () => {
    expect(await s.repo.listFiles('sup1', 't1')).toEqual([]);

    s.fake.seed('supplier_founding_documents', [
      { id: 'd1', supplier_id: 'sup1', founding_document_type_id: 't1' },
    ]);
    s.fake.seed('founding_document_files', [
      {
        id: 'f1',
        supplier_founding_document_id: 'd1',
        file_name: 'a.pdf',
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    s.fake.seed('users', [{ id: 'u1', full_name: 'Петров П.П.' }]);
    const res = await s.repo.listFiles('sup1', 't1');
    expect(res.length).toBe(1);
    expect(res[0]!.created_by_name).toBe('Петров П.П.');
  });

  it('getFileForDeletion + deleteFile', async () => {
    s.fake.seed('founding_document_files', [{ id: 'f1', file_key: 'key/1.pdf' }]);
    expect(await s.repo.getFileForDeletion('f1')).toEqual({ fileKey: 'key/1.pdf' });
    expect(await s.repo.getFileForDeletion('missing')).toBeNull();
    await s.repo.deleteFile('f1');
    expect(s.fake.tableRows('founding_document_files').length).toBe(0);
  });
});
