/**
 * Unit-тесты migration runner (чистая логика, без БД — выполняются в обычном `npm test`).
 * Интеграционная часть (runMigrations против реального PG) — в integration-тестах под Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeChecksum,
  parseMigrationVersion,
  parseMigrationName,
  parseCoversThrough,
  loadMigrationFiles,
  planMigrations,
  containsTransactionControl,
  ChecksumMismatchError,
  TransactionControlError,
  DEFAULT_MIGRATIONS_DIR,
  type MigrationFile,
  type AppliedMigration,
} from './migrate.js';

describe('migrate: чистые хелперы', () => {
  it('computeChecksum детерминирован и нормализует CRLF→LF', () => {
    expect(computeChecksum('a\nb')).toBe(computeChecksum('a\r\nb'));
    expect(computeChecksum('x')).toMatch(/^[a-f0-9]{64}$/);
    expect(computeChecksum('x')).not.toBe(computeChecksum('y'));
  });

  it('parseMigrationVersion', () => {
    expect(parseMigrationVersion('0000_baseline.sql')).toBe(0);
    expect(parseMigrationVersion('006_add_x.sql')).toBe(6);
    expect(parseMigrationVersion('readme.md')).toBeNull();
  });

  it('parseMigrationName', () => {
    expect(parseMigrationName('006_add_supplier_x.sql')).toBe('add_supplier_x');
    expect(parseMigrationName('0000_baseline.sql')).toBe('baseline');
  });

  it('parseCoversThrough', () => {
    expect(parseCoversThrough('-- migrate:baseline-covers-through=6\nSELECT 1;')).toBe(6);
    expect(parseCoversThrough('нет директивы')).toBe(-1);
  });
});

describe('migrate: loadMigrationFiles', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mig-'));
    writeFileSync(path.join(dir, '002_b.sql'), 'SELECT 2;');
    writeFileSync(path.join(dir, '0000_baseline.sql'), 'SELECT 0;');
    writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('читает только .sql, сортирует по версии', () => {
    const files = loadMigrationFiles(dir);
    expect(files.map((f) => f.version)).toEqual([0, 1, 2]);
    expect(files[0]?.name).toBe('baseline');
    expect(files.every((f) => /^[a-f0-9]{64}$/.test(f.checksum))).toBe(true);
  });

  it('бросает при дублирующемся номере версии', () => {
    const d2 = mkdtempSync(path.join(tmpdir(), 'mig2-'));
    writeFileSync(path.join(d2, '001_a.sql'), 'a');
    writeFileSync(path.join(d2, '001_b.sql'), 'b');
    expect(() => loadMigrationFiles(d2)).toThrow(/Дублирующийся номер/);
    rmSync(d2, { recursive: true, force: true });
  });
});

describe('migrate: planMigrations (ядро)', () => {
  const files: MigrationFile[] = [
    { version: 0, name: 'baseline', filename: '0000_baseline.sql', sql: 'b', checksum: 'cb' },
    { version: 1, name: 'a', filename: '001_a.sql', sql: 'a', checksum: 'c1' },
    { version: 2, name: 'b', filename: '002_b.sql', sql: 'b2', checksum: 'c2' },
    { version: 7, name: 'new', filename: '007_new.sql', sql: 'n', checksum: 'c7' },
  ];
  const coversThrough = 6;

  it('чистая БД: baseline execute, 1-6 cover, 7 execute', () => {
    const plan = planMigrations(files, [], coversThrough);
    const byVersion = Object.fromEntries(plan.items.map((i) => [i.version, i.action]));
    expect(byVersion[0]).toBe('execute');
    expect(byVersion[1]).toBe('cover');
    expect(byVersion[2]).toBe('cover');
    expect(byVersion[7]).toBe('execute');
    expect(plan.toExecute).toBe(2);
    expect(plan.toCover).toBe(2);
    expect(plan.toSkip).toBe(0);
  });

  it('всё применено и checksum совпадает → skip', () => {
    const applied: AppliedMigration[] = files.map((f) => ({
      version: f.version,
      name: f.name,
      checksum: f.checksum,
    }));
    const plan = planMigrations(files, applied, coversThrough);
    expect(plan.toSkip).toBe(4);
    expect(plan.toExecute).toBe(0);
    expect(plan.toCover).toBe(0);
  });

  it('checksum-несоответствие применённой миграции → ChecksumMismatchError', () => {
    const applied: AppliedMigration[] = [{ version: 1, name: 'a', checksum: 'ИЗМЕНЁН' }];
    expect(() => planMigrations(files, applied, coversThrough)).toThrow(ChecksumMismatchError);
  });

  it('новая миграция 007 при applied 0-2 → execute только 7', () => {
    const applied: AppliedMigration[] = [
      { version: 0, name: 'baseline', checksum: 'cb' },
      { version: 1, name: 'a', checksum: 'c1' },
      { version: 2, name: 'b', checksum: 'c2' },
    ];
    const plan = planMigrations(files, applied, coversThrough);
    expect(plan.items.find((i) => i.version === 7)?.action).toBe('execute');
    expect(plan.toExecute).toBe(1);
    expect(plan.toSkip).toBe(3);
  });

  it('coversThrough=-1 (нет baseline-директивы): все execute', () => {
    const plan = planMigrations(files, [], -1);
    expect(plan.items.every((i) => i.action === 'execute')).toBe(true);
  });

  it('execute-миграция с top-level BEGIN/COMMIT → TransactionControlError', () => {
    const withTx: MigrationFile[] = [
      {
        version: 7,
        name: 'tx',
        filename: '007_tx.sql',
        sql: 'BEGIN;\nALTER TABLE x ADD COLUMN c int;\nCOMMIT;',
        checksum: 'cx',
      },
    ];
    expect(() => planMigrations(withTx, [], 6)).toThrow(TransactionControlError);
  });

  it('cover-миграция с BEGIN/COMMIT НЕ падает (не исполняется)', () => {
    const covered: MigrationFile[] = [
      {
        version: 3,
        name: 'x',
        filename: '003_x.sql',
        sql: 'BEGIN;\nSELECT 1;\nCOMMIT;',
        checksum: 'c3',
      },
    ];
    expect(() => planMigrations(covered, [], 6)).not.toThrow();
  });
});

describe('migrate: containsTransactionControl', () => {
  it('ловит top-level BEGIN/COMMIT/ROLLBACK', () => {
    expect(containsTransactionControl('BEGIN;\nSELECT 1;\nCOMMIT;')).toBe(true);
    expect(containsTransactionControl('ROLLBACK;')).toBe(true);
    expect(containsTransactionControl('START TRANSACTION;')).toBe(true);
  });
  it('обычный DDL без транзакции → false', () => {
    expect(containsTransactionControl('ALTER TABLE x ADD COLUMN c int;')).toBe(false);
  });
  it('PL/pgSQL BEGIN/END внутри $$...$$ НЕ считается', () => {
    const fn =
      'CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  UPDATE x SET a = 1;\nEND;\n$$ LANGUAGE plpgsql;';
    expect(containsTransactionControl(fn)).toBe(false);
  });
});

describe('migrate: реальные миграции репозитория', () => {
  it('baseline объявляет covers-through=6', () => {
    const files = loadMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    const baseline = files.find((f) => f.version === 0);
    expect(baseline).toBeDefined();
    expect(parseCoversThrough(baseline!.sql)).toBe(6);
  });

  it('план: baseline execute (без tx-control), 001-006 covered — без ошибок', () => {
    const files = loadMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    const plan = planMigrations(files, [], 6);
    expect(plan.items.find((i) => i.version === 0)?.action).toBe('execute');
    expect(plan.toCover).toBeGreaterThanOrEqual(6);
    // baseline не должен содержать top-level BEGIN/COMMIT (иначе runner сломал бы атомарность)
    expect(containsTransactionControl(files.find((f) => f.version === 0)!.sql)).toBe(false);
  });
});
