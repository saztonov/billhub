/**
 * Обновление профиля пользователя админом, включая смену логина (email).
 *
 * Роут остаётся тонким, вся оркестрация — здесь, потому что смена email затрагивает три системы:
 *   1) локальную БД (email + отзыв сессий + погашение reset-токенов — одна транзакция репозитория);
 *   2) Keycloak (в realm su10 `username` = email; локальный отзыв refresh там ни на что не влияет);
 *   3) in-memory кеш профилей authenticate (TTL 15 c).
 *
 * Инварианты:
 *   - изменение ТОЛЬКО регистра/пробелов сменой не считается (в проде есть записи с заглавными
 *     буквами; рутинное сохранение карточки не должно рвать им сессии);
 *   - в supabase-bridge смена запрещена: логин там проверяется в Supabase Auth, а не в public.users;
 *   - порядок для keycloak — внешняя система, затем локальная транзакция, при её сбое компенсация
 *     (тот же паттерн, что в admin-create keycloak-режима).
 */
import { emailHmac } from '../../middleware/rate-limit.js';
import { ConflictError, UniqueConstraintError, ValidationError } from '../../repositories/types.js';
import { KcUserExistsError, type KeycloakAdminClient } from '../auth/keycloak/admin-client.js';
import type { AuthMode } from '../../plugins/auth.js';
import type { AuditLogger } from '../auth/audit.js';
import type { IdentityLinkStore } from '../auth/stores/types.js';
import type { UserRepository, UserSitesUpdate } from '../../repositories/user.repository.js';

/** Часть Keycloak Admin-клиента, нужная смене логина (упрощает подмену в тестах). */
export type KeycloakEmailPort = Pick<
  KeycloakAdminClient,
  'updateUserEmail' | 'logoutAllSessions' | 'findUserByEmail' | 'getUserById'
>;

/** Минимальный логгер (совместим с fastify.log). */
export interface ServiceLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface UserEmailServiceDeps {
  users: UserRepository;
  authMode: AuthMode;
  identityLinks: IdentityLinkStore;
  identityProvider: string;
  keycloak: KeycloakEmailPort;
  audit: AuditLogger;
  auditHmacKey: string;
  log: ServiceLogger;
  invalidateUserCache: (userId: string) => void;
}

export interface UpdateUserProfileInput {
  profile: Omit<UserSitesUpdate, 'emailChange'>;
  /** Канонизированный новый адрес; undefined — тело без смены логина (старый фронт). */
  email?: string;
  /** Канонизированный адрес, который админ видел в карточке. */
  expectedEmail?: string;
}

export interface UpdateUserProfileResult {
  emailChanged: boolean;
}

/** Актор операции (администратор из запроса). */
export interface Actor {
  id: string;
  email: string;
}

interface KeycloakApplied {
  subject: string;
  preimage: { username?: string; email?: string; emailVerified?: boolean };
}

/** trim + lowercase — та же канонизация, что в zod-схеме и в индексе users_email_lower_unique_idx. */
function canonical(email: string): string {
  return email.trim().toLowerCase();
}

export class UserEmailService {
  constructor(private readonly deps: UserEmailServiceDeps) {}

  /**
   * Обновляет профиль и, если адрес действительно меняется, — логин пользователя.
   * Бросает NotFoundError (404), ConflictError (409: устаревшая карточка / нет идентичности в KC),
   * UniqueConstraintError (409: адрес занят), ValidationError (400: режим не поддерживает смену).
   */
  async updateProfile(
    actor: Actor,
    userId: string,
    input: UpdateUserProfileInput,
  ): Promise<UpdateUserProfileResult> {
    const { users, authMode, audit, auditHmacKey, invalidateUserCache } = this.deps;

    const current = await users.getById(userId);
    const currentEmail = canonical(current.email);
    const nextEmail = input.email;
    const isChange = nextEmail !== undefined && nextEmail !== currentEmail;

    if (!isChange) {
      await users.updateWithSites(userId, input.profile);
      invalidateUserCache(userId);
      return { emailChanged: false };
    }

    if (authMode === 'supabase-bridge') {
      throw new ValidationError(
        'Смена email недоступна в режиме supabase-bridge: логин хранится в Supabase Auth',
      );
    }
    if (input.expectedEmail !== currentEmail) {
      throw new ConflictError(
        'Email пользователя изменился в другой сессии. Обновите список и повторите',
      );
    }

    const applied = authMode === 'keycloak' ? await this.applyKeycloak(userId, nextEmail) : null;

    try {
      await users.updateWithSites(userId, {
        ...input.profile,
        emailChange: { expected: currentEmail, next: nextEmail },
      });
    } catch (err) {
      if (applied) await this.compensateKeycloak(userId, applied, nextEmail);
      throw err;
    }

    invalidateUserCache(userId);
    if (applied) await this.logoutKeycloak(userId, applied.subject);

    audit.emit('email_change', {
      userId: actor.id,
      emailHmac: emailHmac(actor.email, auditHmacKey),
      targetType: 'user',
      targetId: userId,
      oldEmailHmac: emailHmac(currentEmail, auditHmacKey),
      newEmailHmac: emailHmac(nextEmail, auditHmacKey),
    });

    return { emailChanged: true };
  }

  /**
   * Меняет логин в Keycloak до локальной записи. Subject берём из user_identity_links, а если связи
   * ещё нет (пользователь ни разу не входил после массового импорта) — ищем в KC по текущему адресу:
   * пропустить синхронизацию нельзя, иначе KC останется со старым username и вход сломается.
   */
  private async applyKeycloak(userId: string, nextEmail: string): Promise<KeycloakApplied> {
    const { identityLinks, identityProvider, keycloak, users } = this.deps;

    const linked = await identityLinks.findSubjectByUserId(identityProvider, userId);
    let subject = linked;
    if (!subject) {
      const record = await users.getById(userId);
      const found = await keycloak.findUserByEmail(canonical(record.email));
      if (!found) {
        throw new ConflictError(
          'Пользователь не найден в Keycloak — смена email невозможна до синхронизации идентичности',
        );
      }
      subject = found.id;
    }

    try {
      const preimage = await keycloak.updateUserEmail(subject, nextEmail);
      return { subject, preimage };
    } catch (err) {
      if (err instanceof KcUserExistsError) {
        throw new UniqueConstraintError('User', 'email', nextEmail);
      }
      throw err;
    }
  }

  /**
   * Возврат Keycloak к прежнему адресу после сбоя локальной транзакции. Компенсируем только если в
   * KC всё ещё стоит адрес, который записали мы: иначе запись успел изменить кто-то ещё и откат
   * затрёт чужое изменение. Любой нештатный исход — critical-событие, без раскрытия адресов.
   */
  private async compensateKeycloak(
    userId: string,
    applied: KeycloakApplied,
    appliedEmail: string,
  ): Promise<void> {
    const { keycloak, audit, log } = this.deps;
    const { subject, preimage } = applied;

    const reportFailure = (reason: string): void => {
      log.error({ userId, subject, reason }, 'email_change: рассинхрон с Keycloak');
      audit.emit('identity_sync_failed', {
        targetType: 'user',
        targetId: userId,
        reason,
      });
    };

    try {
      const now = await keycloak.getUserById(subject);
      if (!now || canonical(now.email ?? '') !== appliedEmail) {
        reportFailure('compensation_skipped_external_change');
        return;
      }
      if (!preimage.email) {
        reportFailure('compensation_skipped_no_preimage');
        return;
      }
      if (preimage.username && canonical(preimage.username) !== canonical(preimage.email)) {
        log.warn(
          { userId, subject },
          'email_change: в Keycloak username не совпадал с email, восстановлен по email',
        );
      }
      await keycloak.updateUserEmail(subject, preimage.email, preimage.emailVerified ?? true);
    } catch {
      reportFailure('compensation_failed');
    }
  }

  /**
   * Завершение сессий Keycloak после успешной смены. Сбой не откатывает операцию (email уже
   * сменён корректно), но фиксируется: сессии проживут до истечения своих токенов.
   */
  private async logoutKeycloak(userId: string, subject: string): Promise<void> {
    const { keycloak, audit, log } = this.deps;
    try {
      await keycloak.logoutAllSessions(subject);
    } catch (err) {
      log.error({ err, userId, subject }, 'email_change: не удалось завершить сессии Keycloak');
      audit.emit('identity_sync_failed', {
        targetType: 'user',
        targetId: userId,
        reason: 'logout_failed',
      });
    }
  }
}
