import { describe, it, expect } from 'vitest';
import {
  createSupplierBodySchema,
  updateSupplierBodySchema,
  supplierSchema,
  listSuppliersQuerySchema,
} from './supplier.js';

describe('supplier schemas', () => {
  it('createSupplierBodySchema требует name и валидный ИНН (10 или 12 цифр)', () => {
    expect(createSupplierBodySchema.safeParse({ name: 'A', inn: '7710140679' }).success).toBe(true);
    expect(createSupplierBodySchema.safeParse({ name: 'A', inn: '500100732259' }).success).toBe(
      true,
    );
    expect(createSupplierBodySchema.safeParse({ name: '', inn: '7710140679' }).success).toBe(false);
    expect(createSupplierBodySchema.safeParse({ name: 'A', inn: '123' }).success).toBe(false);
  });

  it('createSupplierBodySchema вырезает пробелы из ИНН, но не прочий текст', () => {
    const spaced = createSupplierBodySchema.safeParse({ name: 'A', inn: ' 7710 140679 ' });
    expect(spaced.success).toBe(true);
    expect(spaced.success && spaced.data.inn).toBe('7710140679');

    // неразрывный пробел (копирование из PDF/письма)
    const nbsp = createSupplierBodySchema.safeParse({ name: 'A', inn: '7710 140679' });
    expect(nbsp.success).toBe(true);
    expect(nbsp.success && nbsp.data.inn).toBe('7710140679');

    // префикс «ИНН» по-прежнему отклоняется
    expect(createSupplierBodySchema.safeParse({ name: 'A', inn: 'ИНН 7710140679' }).success).toBe(
      false,
    );
  });

  it('updateSupplierBodySchema вырезает пробелы из ИНН', () => {
    const r = updateSupplierBodySchema.safeParse({ inn: '7710 140679' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.inn).toBe('7710140679');
  });

  it('createSupplierBodySchema принимает alternativeNames', () => {
    expect(
      createSupplierBodySchema.safeParse({ name: 'A', inn: '7710140679', alternativeNames: ['x'] })
        .success,
    ).toBe(true);
  });

  it('updateSupplierBodySchema: частичное обновление и foundingDocumentsComment=null', () => {
    expect(updateSupplierBodySchema.safeParse({}).success).toBe(true);
    expect(updateSupplierBodySchema.safeParse({ foundingDocumentsComment: null }).success).toBe(
      true,
    );
    expect(updateSupplierBodySchema.safeParse({ name: 'Новое' }).success).toBe(true);
  });

  it('supplierSchema валидирует полный DTO', () => {
    const ok = supplierSchema.safeParse({
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      name: 'Поставщик',
      inn: '7710140679',
      alternativeNames: [],
      createdAt: '2026-01-01T00:00:00+00:00',
      lastSecurityStatus: 'approved',
    });
    expect(ok.success).toBe(true);
  });

  it('listSuppliersQuerySchema: дефолты пагинации и sbFilter', () => {
    const r = listSuppliersQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
    expect(r.sbFilter).toBe('all');
  });
});
