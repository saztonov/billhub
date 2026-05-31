/**
 * Unit-тест MailStub: «отправка» пишется в локальный JSON-лог (NDJSON), а не в audit_log.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MailStub } from './mail-stub.js';

describe('MailStub', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('sendPasswordReset пишет NDJSON-строку с токеном в свой лог', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mail-'));
    const logPath = path.join(dir, 'mail-stub.log');
    const mail = new MailStub(logPath);

    await mail.sendPasswordReset({ id: 'u1', email: 'u@e.com' }, 'PLAIN-RESET-TOKEN');

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf8').trim();
    const entry = JSON.parse(content) as Record<string, unknown>;
    expect(entry.type).toBe('password_reset');
    expect(entry.to).toBe('u@e.com');
    expect(entry.userId).toBe('u1');
    // токен присутствует в лог-заглушке (это имитация e-mail-канала, НЕ audit_log)
    expect(entry.token).toBe('PLAIN-RESET-TOKEN');
  });

  it('несколько писем добавляются построчно (append)', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mail-'));
    const logPath = path.join(dir, 'mail-stub.log');
    const mail = new MailStub(logPath);
    await mail.sendPasswordReset({ id: 'u1', email: 'a@e.com' }, 'T1');
    await mail.sendPasswordReset({ id: 'u2', email: 'b@e.com' }, 'T2');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
