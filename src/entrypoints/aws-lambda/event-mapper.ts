import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import type { HttpRequest, HttpResponse } from '../http/http-contract.js';

/**
 * Fronteira com a AWS. Todo conhecimento sobre o formato de evento do provedor
 * mora neste arquivo -- portar para outra nuvem significa escrever o
 * equivalente disto, sem tocar em core, adapters ou controllers.
 */

export function toHttpRequest(event: APIGatewayProxyEvent): HttpRequest {
  const body = event.isBase64Encoded && event.body !== null
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  return {
    method: event.httpMethod,
    path: event.path,
    headers: normalizeHeaders(event.headers),
    body,
    sourceIp: event.requestContext?.identity?.sourceIp ?? undefined,
    correlationId: event.requestContext?.requestId ?? undefined,
  };
}

export function toProxyResult(response: HttpResponse): APIGatewayProxyResult {
  return {
    statusCode: response.status,
    headers: { ...response.headers },
    body: response.body,
  };
}

export function authorizerRequestFrom(event: APIGatewayRequestAuthorizerEvent): {
  authorizationHeader: string | undefined;
  path: string;
  method: string;
  correlationId: string | undefined;
} {
  const headers = normalizeHeaders(event.headers);

  return {
    authorizationHeader: headers.authorization,
    // O authorizer recebe o caminho ja resolvido; `path` reflete a rota real
    // pedida pelo cliente, que e o que a matriz de acesso avalia.
    path: event.path ?? '/',
    method: event.httpMethod ?? 'GET',
    correlationId: event.requestContext?.requestId ?? undefined,
  };
}

/**
 * Deriva um ARN curinga a partir do methodArn.
 *
 * Necessario porque o resultado do autorizador e cacheado por token: se a
 * politica apontasse para o metodo especifico da primeira chamada, a segunda
 * rota do mesmo usuario seria negada indevidamente pelo cache.
 *
 * Formato: arn:aws:execute-api:regiao:conta:apiId/stage/METODO/recurso
 */
export function toWildcardResource(methodArn: string): string {
  const [arn, partition, service, region, accountId, apiGatewayPart] = methodArn.split(':');
  const apiId = apiGatewayPart?.split('/')[0];
  const stage = apiGatewayPart?.split('/')[1];

  if (apiId === undefined || stage === undefined) return methodArn;

  return `${arn}:${partition}:${service}:${region}:${accountId}:${apiId}/${stage}/*/*`;
}

function normalizeHeaders(
  headers: Record<string, string | undefined> | null | undefined,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}
