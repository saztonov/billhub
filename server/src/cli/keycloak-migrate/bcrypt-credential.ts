/**
 * Ф3 — сборка bcrypt-credential Keycloak строго по контракту
 * `auth/keycloak/providers/CREDENTIAL_CONTRACT.md` (доказан на тест-realm bcrypt-poc 2026-07-05).
 *
 * secretData/credentialData — JSON-СТРОКИ внутри JSON (не вложенные объекты). Отдельного поля `salt`
 * быть не должно: соль и cost содержатся в самой строке хэша `$2[aby]$NN$<соль><digest>`. `algorithm`
 * обязан быть `bcrypt` — по нему KC выбирает SPI-провайдер. Пароли не сбрасываем; после первого входа
 * KC перехэширует в argon2.
 */
import { PasswordService } from '../../services/auth/password.service.js';
import type { KcCredential } from './types.js';

/** Формат bcrypt-хэша с cost в группе 1 (совпадает с password.service). */
const BCRYPT_COST_RE = /^\$2[aby]\$(\d{2})\$/;

/** cost (rounds) из bcrypt-хэша; null — если строка не является bcrypt-хэшем. */
export function bcryptCost(hash: string): number | null {
  const m = BCRYPT_COST_RE.exec(hash);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

/**
 * Строит credential из bcrypt-хэша BillHub. Бросает, если хэш не bcrypt — вызывающий обязан
 * предварительно фильтровать (null/не-bcrypt → импорт без credentials).
 */
export function buildBcryptCredential(hash: string): KcCredential {
  if (!PasswordService.isBcryptHash(hash)) {
    throw new Error('buildBcryptCredential: не bcrypt-хэш');
  }
  const cost = bcryptCost(hash)!;
  return {
    type: 'password',
    algorithm: 'bcrypt',
    secretData: JSON.stringify({ value: hash }),
    credentialData: JSON.stringify({ hashIterations: cost, algorithm: 'bcrypt' }),
  };
}
