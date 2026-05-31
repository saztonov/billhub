/**
 * Unit-тест import-passwords на 100 синтетических пользователях (без Docker).
 * Проверяет перенос bcrypt-хэшей и --verify-sample. PG-драйверы — интеграционно (Iteration 8/9).
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  runImport,
  parseArgs,
  type SourceReader,
  type SourceUser,
  type TargetWriter,
} from './import-passwords.js';

/** Фейк цели: знает заранее заданный набор id (как public.users). */
class FakeTarget implements TargetWriter {
  private readonly hashes = new Map<string, string>();
  constructor(private readonly knownIds: Set<string>) {}
  async setPasswordHash(userId: string, hash: string): Promise<boolean> {
    if (!this.knownIds.has(userId)) return false;
    this.hashes.set(userId, hash);
    return true;
  }
  async getPasswordHash(userId: string): Promise<string | null> {
    return this.hashes.get(userId) ?? null;
  }
}

class FakeSource implements SourceReader {
  constructor(private readonly users: SourceUser[]) {}
  async readUsers(): Promise<SourceUser[]> {
    return this.users;
  }
}

/** 100 синтетических пользователей с реальными bcrypt-хэшами ($2a и $2b вперемешку). */
function synthetic(count: number): SourceUser[] {
  const out: SourceUser[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const raw = bcrypt.hashSync(`password-${i}`, 4);
    // имитируем Supabase: половина в формате $2a
    const hash = i % 2 === 0 ? raw.replace(/^\$2b/, '$2a') : raw;
    out.push({ id, email: `user${i}@example.com`, encryptedPassword: hash });
  }
  return out;
}

describe('import-passwords — 100 синтетических пользователей', () => {
  it('переносит все 100 хэшей и проверяет выборкой 100/100', async () => {
    const users = synthetic(100);
    const knownIds = new Set(users.map((u) => u.id));
    const source = new FakeSource(users);
    const target = new FakeTarget(knownIds);

    // детерминированная «случайность» для воспроизводимости
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const res = await runImport({ source, target, verifySample: 100, random, logger: () => {} });
    expect(res.total).toBe(100);
    expect(res.migrated).toBe(100);
    expect(res.skipped).toBe(0);
    expect(res.verified).toBe(100);
    expect(res.verifyFailures).toEqual([]);
  });

  it('пропускает null / не-bcrypt encrypted_password и отсутствующих в target', async () => {
    const valid = synthetic(3);
    const extra: SourceUser[] = [
      { id: 'no-pass', email: 'n@e.com', encryptedPassword: null },
      { id: 'plain', email: 'p@e.com', encryptedPassword: 'plaintext-not-bcrypt' },
      { id: 'absent', email: 'a@e.com', encryptedPassword: bcrypt.hashSync('x', 4) },
    ];
    const knownIds = new Set(valid.map((u) => u.id)); // 'absent' НЕ в target
    const source = new FakeSource([...valid, ...extra]);
    const target = new FakeTarget(knownIds);

    const res = await runImport({ source, target, verifySample: 0, logger: () => {} });
    expect(res.total).toBe(6);
    expect(res.migrated).toBe(3);
    expect(res.skipped).toBe(3);
  });

  it('перенесённые хэши остаются валидным bcrypt в target', async () => {
    const users = synthetic(5);
    const target = new FakeTarget(new Set(users.map((u) => u.id)));
    await runImport({ source: new FakeSource(users), target, logger: () => {} });
    for (const u of users) {
      const h = await target.getPasswordHash(u.id);
      expect(h).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare(`password-${users.indexOf(u)}`, h!)).toBe(true);
    }
  });
});

describe('import-passwords — parseArgs', () => {
  it('разбирает все опции', () => {
    const args = parseArgs([
      '--source-url',
      'postgres://src',
      '--source-key',
      'svc-key',
      '--target-database-url',
      'postgres://dst',
      '--verify-sample',
      '100',
    ]);
    expect(args.sourceUrl).toBe('postgres://src');
    expect(args.sourceKey).toBe('svc-key');
    expect(args.targetUrl).toBe('postgres://dst');
    expect(args.verifySample).toBe(100);
  });

  it('verify-sample по умолчанию 0', () => {
    const args = parseArgs([
      '--source-url',
      'postgres://x',
      '--target-database-url',
      'postgres://y',
    ]);
    expect(args.verifySample).toBe(0);
  });
});
