import { resolveAccess, type AccessRule } from '../domain/access-policy.js';
import type { Role } from '../domain/role.js';
import type { Logger } from '../ports/logger.js';
import type { AccessTokenClaims, TokenService } from '../ports/token-service.js';

export interface AuthorizeAccessInput {
  readonly authorizationHeader: string | null | undefined;
  readonly path: string;
  readonly method: string;
}

export interface AuthorizeAccessDependencies {
  readonly tokens: TokenService;
  readonly logger: Logger;
  readonly rules?: readonly AccessRule[];
}

export type AuthorizationOutcome =
  | { readonly effect: 'ALLOW'; readonly principal: AccessTokenClaims }
  | { readonly effect: 'ALLOW_ANONYMOUS' }
  | { readonly effect: 'DENY'; readonly status: 401 | 403; readonly reason: DenyReason };

export type DenyReason =
  | 'MISSING_TOKEN'
  | 'MALFORMED_HEADER'
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'INSUFFICIENT_ROLE'
  | 'UNKNOWN_ROUTE';

const BEARER_PREFIX = 'bearer ';

/**
 * Decide se a requisicao pode seguir.
 *
 * Nao consulta banco: trabalha so com o token e a matriz de acesso. Isso mantem
 * a latencia baixa e evita acoplar a autorizacao ao ciclo de vida do banco --
 * o preco e que desativar um funcionario so surte efeito quando o token dele
 * expira.
 */
export async function authorizeAccess(
  input: AuthorizeAccessInput,
  deps: AuthorizeAccessDependencies,
): Promise<AuthorizationOutcome> {
  const { tokens, logger, rules } = deps;

  const access = resolveAccess(input.path, input.method, rules);

  // Rota nao mapeada: nega. Default deny, sempre.
  if (access.kind === 'UNKNOWN_ROUTE') {
    logger.warn('authorizer.deny', { reason: 'UNKNOWN_ROUTE', path: input.path, method: input.method });
    return { effect: 'DENY', status: 403, reason: 'UNKNOWN_ROUTE' };
  }

  if (access.kind === 'PUBLIC') {
    logger.debug('authorizer.allow', { anonymous: true, path: input.path });
    return { effect: 'ALLOW_ANONYMOUS' };
  }

  const token = extractBearerToken(input.authorizationHeader);
  if (token === null) {
    const reason: DenyReason = input.authorizationHeader ? 'MALFORMED_HEADER' : 'MISSING_TOKEN';
    logger.warn('authorizer.deny', { reason, path: input.path });
    return { effect: 'DENY', status: 401, reason };
  }

  const verification = await tokens.verify(token);
  if (!verification.valid) {
    const reason: DenyReason = verification.reason === 'EXPIRED' ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN';
    logger.warn('authorizer.deny', { reason, detail: verification.reason, path: input.path });
    return { effect: 'DENY', status: 401, reason };
  }

  const { claims } = verification;
  if (!hasRequiredRole(claims.role, access.roles)) {
    logger.warn('authorizer.deny', {
      reason: 'INSUFFICIENT_ROLE',
      path: input.path,
      role: claims.role,
      userId: claims.userId,
    });
    return { effect: 'DENY', status: 403, reason: 'INSUFFICIENT_ROLE' };
  }

  logger.info('authorizer.allow', { path: input.path, role: claims.role, userId: claims.userId });
  return { effect: 'ALLOW', principal: claims };
}

export function extractBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;

  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith(BEARER_PREFIX)) return null;

  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function hasRequiredRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}
