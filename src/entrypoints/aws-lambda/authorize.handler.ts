import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { getAuthorizationContainer } from '../../composition/container.js';
import { authorizeAccess } from '../../core/usecases/authorize-access.js';
import { authorizerRequestFrom, toWildcardResource } from './event-mapper.js';

const container = getAuthorizationContainer();

/** Sinal que o API Gateway traduz para 401. Qualquer outro erro vira 500. */
const UNAUTHORIZED_SIGNAL = 'Unauthorized';

/**
 * Adaptador de entrada do autorizador.
 *
 * Convencao do API Gateway, que dita o formato do retorno:
 *  - lancar "Unauthorized"        -> 401
 *  - politica com Effect: Deny    -> 403
 *  - politica com Effect: Allow   -> segue para a integracao
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const request = authorizerRequestFrom(event);
  const logger = container.logger.withContext({ traceId: request.correlationId ?? '' });

  const resource = toWildcardResource(event.methodArn);

  let outcome;
  try {
    outcome = await authorizeAccess(
      {
        authorizationHeader: request.authorizationHeader,
        path: request.path,
        method: request.method,
      },
      { tokens: container.tokens, logger },
    );
  } catch (error) {
    // Falha ao resolver a chave de assinatura, por exemplo. Negar e o unico
    // comportamento seguro -- nunca liberar por indisponibilidade.
    logger.error('authorizer.error', {
      detail: error instanceof Error ? error.message : String(error),
    });
    throw new Error(UNAUTHORIZED_SIGNAL);
  }

  if (outcome.effect === 'DENY') {
    if (outcome.status === 401) throw new Error(UNAUTHORIZED_SIGNAL);
    return policy('anonymous', 'Deny', resource);
  }

  if (outcome.effect === 'ALLOW_ANONYMOUS') {
    return policy('anonymous', 'Allow', resource);
  }

  const { principal } = outcome;

  return policy(principal.userId, 'Allow', resource, {
    userId: principal.userId,
    role: principal.role,
    name: principal.name,
    cpf: principal.documentNumber,
  });
}

function policy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    ...(context ? { context } : {}),
  };
}

export default handler;
