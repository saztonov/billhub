import { describe, it, expect } from 'vitest';
import { createRpBodySchema, rpStage1BodySchema } from './rp.js';

/** Общие валидные поля тела создания РП (без supplierId). */
const base = {
  counterpartyId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  siteId: '3fa85f64-5717-4562-b3fc-2c963f66afa7',
  paymentRequestIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa8'],
};

describe('rp schemas — необязательный поставщик (0018)', () => {
  it('createRpBodySchema принимает supplierId: null (РП по СМР)', () => {
    expect(createRpBodySchema.safeParse({ ...base, supplierId: null }).success).toBe(true);
  });

  it('createRpBodySchema принимает supplierId: uuid', () => {
    expect(
      createRpBodySchema.safeParse({
        ...base,
        supplierId: '3fa85f64-5717-4562-b3fc-2c963f66afa9',
      }).success,
    ).toBe(true);
  });

  it('createRpBodySchema отклоняет невалидный supplierId', () => {
    expect(createRpBodySchema.safeParse({ ...base, supplierId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rpStage1BodySchema наследует nullable supplierId и требует блок letter', () => {
    const ok = rpStage1BodySchema.safeParse({
      ...base,
      supplierId: null,
      letter: { subject: 'Тема письма' },
    });
    expect(ok.success).toBe(true);

    // Без блока letter stage1 невалиден.
    expect(rpStage1BodySchema.safeParse({ ...base, supplierId: null }).success).toBe(false);
  });
});
