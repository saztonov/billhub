/**
 * PasswordService — хеширование и проверка паролей (стандарт v3 раздел 13, Iteration 6).
 *
 * bcrypt (cost 12). Совместим с хэшами Supabase auth.users.encrypted_password ($2a/$2b/$2y):
 * bcryptjs.compare принимает любой из этих префиксов, поэтому пользователи логинятся
 * прежними паролями после импорта хэшей (import-passwords.ts).
 *
 * bcryptjs (pure-JS) выбран вместо нативного bcrypt ради портативности (принцип 7):
 * нет node-gyp/нативной компиляции — один и тот же образ работает на Windows-dev и Linux-docker.
 */
import bcrypt from 'bcryptjs';
import { ValidationError } from '../../repositories/types.js';

/** Формат bcrypt-хэша: $2a$ / $2b$ / $2y$ + cost + соль/хэш. */
const BCRYPT_RE = /^\$2[aby]\$(\d{2})\$/;

/** Минимальная длина пароля (совпадает с JSON-схемами роутов и стандартом). */
export const MIN_PASSWORD_LENGTH = 8;

export class PasswordService {
  constructor(private readonly cost: number = 12) {}

  /** Хэширует пароль bcrypt-ом с настроенным cost. */
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  /**
   * Проверяет пароль против bcrypt-хэша. Безопасно возвращает false для пустого/невалидного
   * хэша (например, password_hash=NULL у ещё не импортированного пользователя) — без исключения.
   */
  async compare(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash || !PasswordService.isBcryptHash(hash)) return false;
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  /** Проверка формата bcrypt-хэша ($2a/$2b/$2y). */
  static isBcryptHash(hash: string): boolean {
    return BCRYPT_RE.test(hash);
  }

  /** Нужно ли перехешировать (cost в хэше ниже целевого). false для не-bcrypt. */
  needsRehash(hash: string): boolean {
    const m = BCRYPT_RE.exec(hash);
    if (!m) return true;
    return Number.parseInt(m[1]!, 10) < this.cost;
  }

  /** Валидна ли минимальная сложность пароля (без выброса). */
  static validateStrength(plain: string): boolean {
    return typeof plain === 'string' && plain.length >= MIN_PASSWORD_LENGTH;
  }

  /** Бросает ValidationError (→ 400), если пароль слишком слабый. */
  static assertStrong(plain: string): void {
    if (!PasswordService.validateStrength(plain)) {
      throw new ValidationError(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`);
    }
  }
}
