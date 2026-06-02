/**
 * Unit-тесты replayDelta (rollback Сценарий B/C, ADR-0006) — без БД, инъектированные reader/writer.
 * Сценарии: success, conflict, timeout-retry, partial-batch, retry-exhausted (+ ошибка чтения,
 * non-retryable, parseTablesArg). Покрывает ≥5 требуемых ситуаций.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  replayDelta,
  parseTablesArg,
  type DeltaSourceReader,
  type DeltaTargetWriter,
  type DeltaTableSpec,
  type DeltaRow,
  type ApplyOutcome,
} from './delta-replay-yandex-to-supabase.js';

const SPEC: DeltaTableSpec = { table: 'payment_requests', sinceColumn: 'updated_at' };
const noSleep = () => Promise.resolve();

function reader(rowsByTable: Record<string, DeltaRow[]>): DeltaSourceReader {
  return {
    readSince: (spec) => Promise.resolve(rowsByTable[spec.table] ?? []),
  };
}

/** Writer, управляемый функцией (spec, row, attempt) → ApplyOutcome. attempt начинается с 0. */
function writer(fn: (spec: DeltaTableSpec, row: DeltaRow, attempt: number) => ApplyOutcome): {
  w: DeltaTargetWriter;
  attempts: Map<unknown, number>;
} {
  const attempts = new Map<unknown, number>();
  const w: DeltaTargetWriter = {
    applyRow: (spec, row) => {
      const id = row.id;
      const a = attempts.get(id) ?? 0;
      attempts.set(id, a + 1);
      return Promise.resolve(fn(spec, row, a));
    },
  };
  return { w, attempts };
}

describe('replayDelta', () => {
  it('success: все строки применены', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { w } = writer(() => ({ status: 'applied' }));
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: '2026-01-01T00:00:00Z',
      sleep: noSleep,
    });
    expect(r.totals).toEqual({ read: 3, applied: 3, conflicts: 0, failed: 0 });
    expect(r.failures).toHaveLength(0);
  });

  it('conflict: дубликат PK логируется, не ретраится и не валит прогон', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const onConflict = vi.fn();
    const { w, attempts } = writer((_s, row) =>
      row.id === 2 ? { status: 'conflict', detail: '23505' } : { status: 'applied' },
    );
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: 'T',
      sleep: noSleep,
      onConflict,
    });
    expect(r.totals.applied).toBe(1);
    expect(r.totals.conflicts).toBe(1);
    expect(r.totals.failed).toBe(0);
    expect(onConflict).toHaveBeenCalledWith('payment_requests', 2, '23505');
    expect(attempts.get(2)).toBe(1); // конфликт не ретраится
  });

  it('timeout: транзиентная ошибка ретраится и затем применяется', async () => {
    const rows = [{ id: 1 }];
    const { w, attempts } = writer((_s, _row, attempt) =>
      attempt === 0
        ? { status: 'error', retryable: true, message: 'ETIMEDOUT' }
        : { status: 'applied' },
    );
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: 'T',
      sleep: noSleep,
      maxRetries: 3,
    });
    expect(r.totals.applied).toBe(1);
    expect(r.totals.failed).toBe(0);
    expect(attempts.get(1)).toBe(2); // 1 провал + 1 успешный ретрай
  });

  it('partial-batch: смесь applied/conflict/failed считается верно, обработка не прерывается', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const { w } = writer((_s, row) => {
      if (row.id === 2) return { status: 'conflict' };
      if (row.id === 3) return { status: 'error', retryable: false, message: 'check_violation' };
      return { status: 'applied' };
    });
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: 'T',
      sleep: noSleep,
    });
    expect(r.totals).toEqual({ read: 4, applied: 2, conflicts: 1, failed: 1 });
    expect(r.failures).toEqual([{ table: 'payment_requests', pk: 3, message: 'check_violation' }]);
  });

  it('retry-exhausted: постоянная транзиентная ошибка → failed после maxRetries', async () => {
    const rows = [{ id: 1 }];
    const { w, attempts } = writer(() => ({
      status: 'error',
      retryable: true,
      message: 'ECONNRESET',
    }));
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: 'T',
      sleep: noSleep,
      maxRetries: 2,
    });
    expect(r.totals.failed).toBe(1);
    expect(r.totals.applied).toBe(0);
    expect(attempts.get(1)).toBe(3); // первая попытка + 2 ретрая
  });

  it('non-retryable error не ретраится', async () => {
    const rows = [{ id: 1 }];
    const { w, attempts } = writer(() => ({
      status: 'error',
      retryable: false,
      message: '42P01: relation does not exist',
    }));
    const r = await replayDelta({
      reader: reader({ payment_requests: rows }),
      writer: w,
      tables: [SPEC],
      sinceIso: 'T',
      sleep: noSleep,
      maxRetries: 5,
    });
    expect(r.totals.failed).toBe(1);
    expect(attempts.get(1)).toBe(1);
  });

  it('ошибка чтения таблицы-источника фиксируется как провал таблицы, остальные продолжаются', async () => {
    const badReader: DeltaSourceReader = {
      readSince: (spec) =>
        spec.table === 'broken'
          ? Promise.reject(new Error('connection refused'))
          : Promise.resolve([{ id: 1 }]),
    };
    const { w } = writer(() => ({ status: 'applied' }));
    const r = await replayDelta({
      reader: badReader,
      writer: w,
      tables: [
        { table: 'broken', sinceColumn: 'updated_at' },
        { table: 'ok', sinceColumn: 'created_at' },
      ],
      sinceIso: 'T',
      sleep: noSleep,
    });
    expect(r.totals.failed).toBe(1);
    expect(r.totals.applied).toBe(1);
    expect(r.failures[0]?.message).toMatch(/read failed/);
  });

  it('multi-table агрегаты суммируются по таблицам', async () => {
    const { w } = writer(() => ({ status: 'applied' }));
    const r = await replayDelta({
      reader: reader({ a: [{ id: 1 }], b: [{ id: 2 }, { id: 3 }] }),
      writer: w,
      tables: [
        { table: 'a', sinceColumn: 'updated_at' },
        { table: 'b', sinceColumn: 'created_at' },
      ],
      sinceIso: 'T',
      sleep: noSleep,
    });
    expect(r.totals.read).toBe(3);
    expect(r.totals.applied).toBe(3);
    expect(r.tables).toHaveLength(2);
  });
});

describe('parseTablesArg', () => {
  it('парсит table:column пары и дефолтит на updated_at', () => {
    expect(parseTablesArg('payment_requests:updated_at, notifications:created_at, x')).toEqual([
      { table: 'payment_requests', sinceColumn: 'updated_at' },
      { table: 'notifications', sinceColumn: 'created_at' },
      { table: 'x', sinceColumn: 'updated_at' },
    ]);
  });
});
