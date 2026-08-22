import { AuthError, isAuthError } from '../../core/domain/errors.js';
import type { Logger } from '../../core/ports/logger.js';
import {
  authenticateUser,
  type AuthenticateUserDependencies,
} from '../../core/usecases/authenticate-user.js';
import { jsonResponse, type HttpRequest, type HttpResponse } from './http-contract.js';

export interface AuthenticateControllerDependencies extends AuthenticateUserDependencies {
  readonly logger: Logger;
}

/**
 * Traduz HTTP <-> caso de uso. Nao contem regra de negocio: o que ele faz e
 * desserializar o corpo, delegar e mapear erro para status.
 *
 * O corpo de erro e sempre o mesmo shape { error, message, traceId } -- nunca
 * vaza stack, nome de coluna ou motivo interno.
 */
export async function handleAuthenticate(
  request: HttpRequest,
  deps: AuthenticateControllerDependencies,
): Promise<HttpResponse> {
  const correlationId = request.correlationId ?? '';
  const logger = deps.logger.withContext({
    traceId: correlationId,
    sourceIp: request.sourceIp ?? 'unknown',
  });

  const startedAt = Date.now();

  try {
    const payload = parseBody(request.body);

    const issued = await authenticateUser(
      { documentNumber: payload.cpf, password: payload.password },
      { ...deps, logger },
    );

    return jsonResponse(200, {
      accessToken: issued.token,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
    });
  } catch (error) {
    const authError = isAuthError(error) ? error : unexpected(error, logger);

    return jsonResponse(authError.status, {
      error: authError.code,
      message: authError.message,
      traceId: correlationId,
    });
  } finally {
    logger.debug('login.completed', { durationMs: Date.now() - startedAt });
  }
}

interface LoginPayload {
  readonly cpf: string;
  readonly password: string;
}

function parseBody(body: string | null): LoginPayload {
  if (body === null || body.trim().length === 0) {
    throw AuthError.invalidRequest('Corpo da requisicao ausente');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw AuthError.invalidRequest('Corpo da requisicao nao e JSON valido');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw AuthError.invalidRequest('Corpo da requisicao invalido');
  }

  const { cpf, password } = parsed as Record<string, unknown>;

  if (typeof cpf !== 'string' || typeof password !== 'string') {
    throw AuthError.invalidRequest('Campos "cpf" e "password" sao obrigatorios');
  }

  return { cpf, password };
}

function unexpected(error: unknown, logger: Logger): AuthError {
  logger.error('login.error', {
    reason: 'INTERNAL_ERROR',
    detail: error instanceof Error ? error.message : String(error),
  });

  return AuthError.internal();
}
