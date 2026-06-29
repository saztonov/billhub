/**
 * Заглушка @su10/mail: пишет «отправленные» письма в защищённый локальный JSON-лог (NDJSON),
 * а не отправляет их. ADR-0001 / ADR-0007 (реальный провайдер SES/Postbox отложен).
 *
 * ВАЖНО (C9): лог заглушки (по умолчанию MAIL_STUB_LOG_PATH → <server>/data/mail-stub.log) — это
 * имитация e-mail-канала, НЕ audit_log. В нём допустимо присутствие plain-токена сброса (как ссылка
 * в настоящем письме), поэтому файл создаётся с правами 600 и НЕ должен идти в stdout/docker logs.
 * audit_log токена не содержит (раздел 13). MailDeliveryResult, возвращаемый наружу, токена не несёт.
 */
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAIL_SUBJECTS,
  type MailDeliveryResult,
  type MailMessage,
  type MailPort,
  type MailUser,
} from './mail-port.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Путь по умолчанию: <server>/data/mail-stub.log. */
export const DEFAULT_MAIL_STUB_LOG = path.resolve(__dirname, '../../../data/mail-stub.log');

interface MailStubEntry {
  kind: string;
  to: string;
  userId: string;
  subject: string;
  /** Только для password_reset — как ссылка в настоящем письме. */
  token?: string;
  at: string;
}

export class MailStub implements MailPort {
  constructor(private readonly logPath: string = DEFAULT_MAIL_STUB_LOG) {}

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const at = new Date().toISOString();
    this.append({
      kind: message.kind,
      to: message.to.email,
      userId: message.to.id,
      subject: message.subject,
      token: message.token,
      at,
    });
    // Результат наружу — без токена (пригоден для audit).
    return { kind: message.kind, accepted: true, at };
  }

  async sendPasswordReset(user: MailUser, token: string): Promise<void> {
    await this.send({
      kind: 'password_reset',
      to: user,
      subject: DEFAULT_MAIL_SUBJECTS.password_reset,
      token,
    });
  }

  /** Suppression-seam: этап 1 — никто не в suppression-листе. */
  async isSuppressed(_email: string): Promise<boolean> {
    return false;
  }

  private append(entry: MailStubEntry): void {
    mkdirSync(path.dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    // Лог содержит plain-токен — ограничиваем права (no-op на Windows-FS).
    try {
      chmodSync(this.logPath, 0o600);
    } catch {
      /* chmod не поддержан (Windows) — игнорируем */
    }
  }
}
