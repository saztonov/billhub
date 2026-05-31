/**
 * Заглушка @su10/mail: пишет «отправленные» письма в локальный JSON-лог (NDJSON),
 * а не отправляет их. План Iteration 6 / ADR-0001.
 *
 * ВАЖНО: лог заглушки (по умолчанию server/data/mail-stub.log) — это имитация e-mail-канала,
 * это НЕ audit_log. В нём допустимо присутствие plain-токена сброса (так же, как настоящее
 * письмо содержало бы ссылку с токеном). audit_log при этом токена не содержит (раздел 13).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MailPort, MailUser } from './mail-port.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Путь по умолчанию: <server>/data/mail-stub.log. */
export const DEFAULT_MAIL_STUB_LOG = path.resolve(__dirname, '../../../data/mail-stub.log');

interface MailStubEntry {
  type: string;
  to: string;
  userId: string;
  token?: string;
  at: string;
}

export class MailStub implements MailPort {
  constructor(private readonly logPath: string = DEFAULT_MAIL_STUB_LOG) {}

  async sendPasswordReset(user: MailUser, token: string): Promise<void> {
    this.append({
      type: 'password_reset',
      to: user.email,
      userId: user.id,
      token,
      at: new Date().toISOString(),
    });
  }

  private append(entry: MailStubEntry): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
