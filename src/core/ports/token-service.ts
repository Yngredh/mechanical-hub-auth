import type { Role } from '../domain/role.js';

/**
 * Emissao e verificacao do token de acesso.
 *
 * O core trabalha com AccessTokenClaims; o formato concreto (JWT/HS256 hoje)
 * fica na implementacao.
 */

export interface AccessTokenClaims {
  readonly userId: string;
  readonly name: string;
  readonly documentNumber: string;
  readonly role: Role;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresInSeconds: number;
}

export type TokenVerificationResult =
  | { readonly valid: true; readonly claims: AccessTokenClaims }
  | { readonly valid: false; readonly reason: TokenRejectionReason };

export type TokenRejectionReason =
  | 'EXPIRED'
  | 'INVALID_SIGNATURE'
  | 'MALFORMED'
  | 'UNTRUSTED_ISSUER'
  | 'UNSUPPORTED_ALGORITHM'
  | 'MISSING_CLAIMS';

export interface TokenService {
  issue(claims: AccessTokenClaims): Promise<IssuedToken>;
  verify(token: string): Promise<TokenVerificationResult>;
}
