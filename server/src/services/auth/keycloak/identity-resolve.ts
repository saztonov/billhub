/**
 * Ф1 — provider-agnostic резолв идентичности Keycloak → локальный профиль. Порядок:
 *   1) claim `billhub_user_id` из verified JWT → users.findById (основной путь после массового импорта);
 *   2) user_identity_links по (provider, subject) среди ['keycloak-ad','keycloak-local'];
 * (email-fallback — только на callback, т.к. пишет link; здесь read-only.)
 *
 * Резолв НЕ завязан на глобальный AUTH_IDENTITY_PROVIDER: один users.id может иметь несколько
 * провайдеров (local сейчас, AD позже). Возвращает null, если не резолвится (гейт-403/онбординг —
 * забота вызывающего).
 */
import type { UserAuthRecord } from '../stores/types.js';

/** Порядок проверки провайдеров в links (AD раньше local — приоритет свежего провайдера). */
export const KEYCLOAK_PROVIDERS: readonly string[] = ['keycloak-ad', 'keycloak-local'];

export interface IdentityResolveStores {
  users: { findById(id: string): Promise<UserAuthRecord | null> };
  links: { findBySubject(provider: string, subject: string): Promise<{ userId: string } | null> };
}

export interface IdentityResolveInput {
  billhubUserId?: string | null;
  sub: string;
}

export interface IdentityResolveResult {
  rec: UserAuthRecord;
  via: 'claim' | 'link';
  /** Провайдер, по которому найден link (только для via='link'). */
  provider?: string;
}

export async function resolveKeycloakIdentity(
  stores: IdentityResolveStores,
  input: IdentityResolveInput,
): Promise<IdentityResolveResult | null> {
  if (input.billhubUserId) {
    const rec = await stores.users.findById(input.billhubUserId);
    if (rec) return { rec, via: 'claim' };
  }
  for (const provider of KEYCLOAK_PROVIDERS) {
    const link = await stores.links.findBySubject(provider, input.sub);
    if (link) {
      const rec = await stores.users.findById(link.userId);
      if (rec) return { rec, via: 'link', provider };
    }
  }
  return null;
}
