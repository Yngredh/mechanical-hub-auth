import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { isRole } from '../../core/domain/role.js';
import type {
  AccessTokenClaims,
  IssuedToken,
  TokenRejectionReason,
  TokenService,
  TokenVerificationResult,
} from '../../core/ports/token-service.js';

export interface JwtTokenServiceOptions {
  /** Resolvido sob demanda para permitir cache e rotacao sem redeploy. */
  readonly resolveSigningKey: () => Promise<string>;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}

const ALGORITHM = 'HS256' as const;

/**
 * JWT simetrico (HS256), o mesmo algoritmo que o TokenService da aplicacao
 * principal usava -- escolha deliberada para reduzir o atrito da migracao.
 *
 * A verificacao fixa o algoritmo. Sem isso, um token com alg "none" ou com
 * algoritmo assimetrico poderia ser aceito (ataque classico de confusao de
 * algoritmo).
 */
export class JwtTokenService implements TokenService {
  constructor(private readonly options: JwtTokenServiceOptions) {}

  async issue(claims: AccessTokenClaims): Promise<IssuedToken> {
    const key = await this.options.resolveSigningKey();

    const signOptions: SignOptions = {
      algorithm: ALGORITHM,
      issuer: this.options.issuer,
      audience: this.options.audience,
      subject: claims.userId,
      expiresIn: this.options.ttlSeconds,
      jwtid: randomUUID(),
    };

    const token = jwt.sign(
      {
        cpf: claims.documentNumber,
        name: claims.name,
        role: claims.role,
      },
      key,
      signOptions,
    );

    return { token, expiresInSeconds: this.options.ttlSeconds };
  }

  async verify(token: string): Promise<TokenVerificationResult> {
    const key = await this.options.resolveSigningKey();

    let payload: JwtPayload;
    try {
      const decoded = jwt.verify(token, key, {
        algorithms: [ALGORITHM],
        issuer: this.options.issuer,
        audience: this.options.audience,
      });

      if (typeof decoded === 'string') {
        return { valid: false, reason: 'MALFORMED' };
      }
      payload = decoded;
    } catch (error) {
      return { valid: false, reason: mapVerificationError(error) };
    }

    const claims = toClaims(payload);
    return claims === null ? { valid: false, reason: 'MISSING_CLAIMS' } : { valid: true, claims };
  }
}

function toClaims(payload: JwtPayload): AccessTokenClaims | null {
  const { sub, name, cpf, role } = payload;

  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof cpf !== 'string' || cpf.length === 0) return null;
  if (!isRole(role)) return null;

  return {
    userId: sub,
    name: typeof name === 'string' ? name : '',
    documentNumber: cpf,
    role,
  };
}

function mapVerificationError(error: unknown): TokenRejectionReason {
  if (!(error instanceof Error)) return 'MALFORMED';

  if (error.name === 'TokenExpiredError') return 'EXPIRED';

  const message = error.message.toLowerCase();
  if (message.includes('audience') || message.includes('issuer')) return 'UNTRUSTED_ISSUER';
  if (message.includes('algorithm')) return 'UNSUPPORTED_ALGORITHM';
  if (message.includes('signature')) return 'INVALID_SIGNATURE';

  return 'MALFORMED';
}
