/**
 * TokenService — access JWT (jose, HS256) + opaque refresh token (стандарт v3 раздел 13).
 *
 * Access JWT:  iss=BillHub, aud=billhub, exp=15 мин (конфигурируемо). Подпись HS256
 *   секретом AUTH_JWT_SECRET. (Этап 2 переходит на асимметричный JWKS Keycloak — раздел 9.)
 * Refresh:     opaque, 32 случайных байта → base64url (43 символа). В БД хранится только
 *   SHA-256-хэш (раздел 13: «хранение hash refresh token в БД»), сам токен — только в cookie.
 *
 * `now` инъектируется для детерминированных тестов exp/iat без реального ожидания.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export interface TokenServiceOptions {
  secret: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  /** Источник времени (мс). По умолчанию Date.now. */
  now?: () => number;
}

/** Полезная нагрузка access-токена. */
export interface AccessClaims {
  sub: string;
  role: string;
  email?: string;
}

/** Пара refresh-токена: plain выдаётся клиенту, hash кладётся в БД. */
export interface RefreshTokenPair {
  plain: string;
  hash: string;
}

/** Длина base64url-представления 32 байт (без паддинга). */
const REFRESH_TOKEN_LENGTH = 43;
const REFRESH_FORMAT_RE = /^[A-Za-z0-9_-]{43}$/;

export class TokenService {
  private readonly secretKey: Uint8Array;
  private readonly now: () => number;

  constructor(private readonly opts: TokenServiceOptions) {
    this.secretKey = new TextEncoder().encode(opts.secret);
    this.now = opts.now ?? Date.now;
  }

  /** Подписывает access JWT. Возвращает токен и время истечения (unix ms). */
  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresAtMs: number }> {
    const iatSec = Math.floor(this.now() / 1000);
    const expSec = iatSec + this.opts.accessTtlSeconds;
    const payload: JWTPayload = { role: claims.role };
    if (claims.email !== undefined) payload.email = claims.email;
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.opts.issuer)
      .setAudience(this.opts.audience)
      .setIssuedAt(iatSec)
      .setExpirationTime(expSec)
      .sign(this.secretKey);
    return { token, expiresAtMs: expSec * 1000 };
  }

  /**
   * Верифицирует access JWT (подпись + iss + aud + exp). Бросает при невалидном.
   * `currentDate` позволяет тесту проверить истечение без ожидания.
   */
  async verifyAccess(token: string, currentDate?: Date): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.secretKey, {
      issuer: this.opts.issuer,
      audience: this.opts.audience,
      ...(currentDate ? { currentDate } : {}),
    });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('access-токен без sub');
    }
    return {
      sub: payload.sub,
      role: typeof payload.role === 'string' ? payload.role : '',
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }

  /** Генерирует opaque refresh-токен и его SHA-256-хэш. */
  generateRefreshToken(): RefreshTokenPair {
    const plain = randomBytes(32).toString('base64url');
    return { plain, hash: TokenService.hashRefreshToken(plain) };
  }

  /** SHA-256 hex от plain refresh-токена (то, что хранится в refresh_tokens.token_hash). */
  static hashRefreshToken(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  /** Проверка формата opaque refresh-токена (base64url, 32 байта). */
  static isValidRefreshFormat(plain: string): boolean {
    return plain.length === REFRESH_TOKEN_LENGTH && REFRESH_FORMAT_RE.test(plain);
  }
}
