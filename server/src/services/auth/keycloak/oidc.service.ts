/**
 * OIDC-сервис Keycloak (BFF, Authorization Code + PKCE). Оборачивает openid-client v6:
 * discovery (кешированный), построение authorization/end-session URL, обмен code на токены,
 * refresh-grant. Протокольный поток — здесь; per-request JWKS-verify — в middleware/authenticate.
 *
 * Инстанцируется лениво только в keycloak-режиме: discovery не выполняется, пока не будет
 * первого обращения, поэтому пустой OIDC_ISSUER не роняет импорт в других режимах.
 */
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  type Configuration,
} from 'openid-client';
import { config } from '../../../config.js';

export interface OidcTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** Абсолютное время истечения access-токена (unix ms), из expires_in. */
  accessTokenExpiresAtMs: number | null;
}

export interface OidcLoginChallenge {
  authorizationUrl: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export interface OidcIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  preferredUsername: string | null;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};

function toTokens(res: TokenResponse): OidcTokens {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? null,
    idToken: res.id_token ?? null,
    accessTokenExpiresAtMs:
      typeof res.expires_in === 'number' ? Date.now() + res.expires_in * 1000 : null,
  };
}

export class OidcService {
  private configPromise: Promise<Configuration> | null = null;

  private async getConfig(): Promise<Configuration> {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        const server = new URL(config.oidcIssuer);
        const cfg = await discovery(
          server,
          config.oidcClientId,
          config.oidcClientSecret,
          ClientSecretPost(config.oidcClientSecret),
        );
        // Локальный/тестовый realm по http — разрешаем; в проде issuer всегда https.
        if (server.protocol === 'http:') allowInsecureRequests(cfg);
        return cfg;
      })().catch((err: unknown) => {
        this.configPromise = null; // повторить discovery при следующем обращении
        throw err;
      });
    }
    return this.configPromise;
  }

  /** Authorization URL (PKCE S256) + challenge для короткоживущей session-cookie. */
  async buildLoginChallenge(): Promise<OidcLoginChallenge> {
    const cfg = await this.getConfig();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const nonce = randomNonce();
    const url = buildAuthorizationUrl(cfg, {
      redirect_uri: config.oidcRedirectUri,
      scope: config.oidcScopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { authorizationUrl: url.href, codeVerifier, state, nonce };
  }

  /** Обмен code на токены + валидация id_token (state/nonce/iss/aud/azp — внутри openid-client). */
  async handleCallback(
    currentUrl: URL,
    checks: { codeVerifier: string; state: string; nonce: string },
  ): Promise<{ tokens: OidcTokens; identity: OidcIdentity }> {
    const cfg = await this.getConfig();
    const res = await authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = res.claims();
    if (!claims?.sub) {
      throw new Error('OIDC callback: отсутствует sub в id_token');
    }
    return {
      tokens: toTokens(res),
      identity: {
        sub: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true,
        preferredUsername:
          typeof claims.preferred_username === 'string' ? claims.preferred_username : null,
      },
    };
  }

  async refresh(refreshToken: string): Promise<OidcTokens> {
    const cfg = await this.getConfig();
    const res = await refreshTokenGrant(cfg, refreshToken);
    return toTokens(res);
  }

  /** End-session URL Keycloak. Без id_token — logout по client_id + post_logout_redirect_uri. */
  async buildLogoutUrl(idToken: string | null): Promise<string> {
    const cfg = await this.getConfig();
    const params: Record<string, string> = {
      post_logout_redirect_uri: config.oidcPostLogoutRedirectUri,
    };
    if (idToken) params.id_token_hint = idToken;
    else params.client_id = config.oidcClientId;
    return buildEndSessionUrl(cfg, params).href;
  }
}

/** Ленивый singleton (используется только в keycloak-режиме). */
export const oidcService = new OidcService();
