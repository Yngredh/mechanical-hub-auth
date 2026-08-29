import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { getAuthorizationContainer } from '../../composition/container.js';
import { authorizeAccess } from '../../core/usecases/authorize-access.js';
import {
  countAuthorizerDecision,
  type AuthorizerDecision,
} from '../../adapters/observability/auth-metrics.js';
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
 *
 * O caminho de saida e por excecao em dois dos tres casos, entao a contagem e o
 * flush ficam num `finally`: sem isso, justamente as negativas — o que mais
 * interessa observar — nunca seriam contabilizadas.
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const request = authorizerRequestFrom(event);

  const span = container.telemetry.startSpan({
    name: 'authorizer',
    attributes: { 'http.route': request.path, 'http.method': request.method },
  });

  const logger = container.logger.withContext({
    traceId: request.correlationId ?? '',
    trace_id: span.context.traceId,
    span_id: span.context.spanId,
  });

  let decision: AuthorizerDecision = 'error';

  try {
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
      decision = 'deny';
      span.end({ attributes: { 'authorizer.decision': 'deny', 'authorizer.reason': outcome.reason } });

      if (outcome.status === 401) throw new Error(UNAUTHORIZED_SIGNAL);
      return policy('anonymous', 'Deny', resource);
    }

    if (outcome.effect === 'ALLOW_ANONYMOUS') {
      decision = 'allow_anonymous';
      span.end({ attributes: { 'authorizer.decision': 'allow_anonymous' } });
      return policy('anonymous', 'Allow', resource);
    }

    const { principal } = outcome;
    decision = 'allow';
    span.end({
      attributes: { 'authorizer.decision': 'allow', 'enduser.role': principal.role },
    });

    return policy(principal.userId, 'Allow', resource, {
      userId: principal.userId,
      role: principal.role,
      name: principal.name,
      cpf: principal.documentNumber,
    });
  } catch (error) {
    // O sinal de 401 tambem passa por aqui, e ele ja fechou o span no ramo do
    // DENY. A guarda evita registrar o mesmo span duas vezes — o que
    // duplicaria a requisicao no Tempo.
    if (decision === 'error') {
      span.end({ error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  } finally {
    countAuthorizerDecision(container.telemetry, decision);
    await container.telemetry.flush();
  }
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
