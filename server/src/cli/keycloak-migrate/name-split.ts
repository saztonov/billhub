/**
 * Ф3 — детерминированный split `full_name` → `firstName`/`lastName` для payload Keycloak.
 *
 * Жёсткое требование: оба поля НЕПУСТЫЕ (иначе KC required-action VERIFY_PROFILE ломает вход
 * `Account is not fully set up` ещё до проверки пароля). Точный семантический разбор ФИО не важен
 * (KC-поля профиля), важны стабильность (тот же вход → тот же выход) и непустота — иначе re-import/
 * reconcile будут дёргать профиль.
 *
 * Правило: первое слово → firstName, остальные → lastName; одно слово → оба одинаковы; пусто →
 * fallback (напр. локальная часть email), иначе литерал `user`.
 */

function normalizeSpace(s: string): string {
  return (s ?? '').trim().replace(/\s+/g, ' ');
}

export function splitFullName(
  fullName: string,
  fallback = '',
): { firstName: string; lastName: string } {
  const cleaned = normalizeSpace(fullName);
  if (cleaned) {
    const parts = cleaned.split(' ');
    if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! };
    return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
  }
  const fb = normalizeSpace(fallback) || 'user';
  return { firstName: fb, lastName: fb };
}
