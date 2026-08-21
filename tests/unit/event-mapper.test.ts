import type { APIGatewayProxyEvent, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import {
  authorizerRequestFrom,
  toHttpRequest,
  toProxyResult,
  toWildcardResource,
} from '../../src/entrypoints/aws-lambda/event-mapper.js';
import { jsonResponse, readHeader } from '../../src/entrypoints/http/http-contract.js';

function proxyEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/auth/login',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
    body: '{"cpf":"52998224725"}',
    isBase64Encoded: false,
    requestContext: {
      requestId: 'req-1',
      identity: { sourceIp: '203.0.113.10' },
    },
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

describe('toHttpRequest', () => {
  it('normaliza os cabecalhos para minusculas', () => {
    const request = toHttpRequest(proxyEvent());

    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers.authorization).toBe('Bearer abc');
  });

  it('propaga requestId como correlacao e o IP de origem', () => {
    const request = toHttpRequest(proxyEvent());

    expect(request.correlationId).toBe('req-1');
    expect(request.sourceIp).toBe('203.0.113.10');
  });

  it('decodifica corpo em base64', () => {
    const request = toHttpRequest(
      proxyEvent({ body: Buffer.from('{"cpf":"1"}').toString('base64'), isBase64Encoded: true }),
    );

    expect(request.body).toBe('{"cpf":"1"}');
  });

  it('preserva corpo nulo', () => {
    expect(toHttpRequest(proxyEvent({ body: null })).body).toBeNull();
  });
});

describe('toProxyResult', () => {
  it('converte a resposta neutra para o formato do provedor', () => {
    expect(toProxyResult(jsonResponse(401, { error: 'INVALID_CREDENTIALS' }))).toEqual({
      statusCode: 401,
      headers: { 'content-type': 'application/json' },
      body: '{"error":"INVALID_CREDENTIALS"}',
    });
  });
});

describe('authorizerRequestFrom', () => {
  it('extrai cabecalho, rota e metodo independente da caixa', () => {
    const event = {
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:abc123/prod/GET/service-orders',
      headers: { AUTHORIZATION: 'Bearer xyz' },
      path: '/service-orders',
      httpMethod: 'GET',
      requestContext: { requestId: 'req-2' },
    } as unknown as APIGatewayRequestAuthorizerEvent;

    expect(authorizerRequestFrom(event)).toEqual({
      authorizationHeader: 'Bearer xyz',
      path: '/service-orders',
      method: 'GET',
      correlationId: 'req-2',
    });
  });

  it('usa valores neutros quando o evento vem incompleto', () => {
    const event = { headers: null } as unknown as APIGatewayRequestAuthorizerEvent;

    expect(authorizerRequestFrom(event)).toMatchObject({ path: '/', method: 'GET' });
  });
});

describe('toWildcardResource', () => {
  it('generaliza o ARN para que o cache do autorizador sirva todas as rotas', () => {
    expect(
      toWildcardResource('arn:aws:execute-api:us-east-1:123456789012:abc123/prod/GET/service-orders'),
    ).toBe('arn:aws:execute-api:us-east-1:123456789012:abc123/prod/*/*');
  });

  it('preserva recursos aninhados na generalizacao', () => {
    expect(
      toWildcardResource('arn:aws:execute-api:us-east-1:123456789012:abc123/prod/PATCH/service-orders/1/tasks'),
    ).toBe('arn:aws:execute-api:us-east-1:123456789012:abc123/prod/*/*');
  });

  it('devolve o ARN original quando o formato nao e reconhecido', () => {
    expect(toWildcardResource('arn-invalido')).toBe('arn-invalido');
  });
});

describe('readHeader', () => {
  it('encontra o cabecalho ignorando a caixa', () => {
    expect(readHeader({ Authorization: 'Bearer abc' }, 'authorization')).toBe('Bearer abc');
  });

  it('retorna undefined quando nao existe', () => {
    expect(readHeader({}, 'authorization')).toBeUndefined();
  });
});
