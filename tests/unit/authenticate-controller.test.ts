import { describe, expect, it } from 'vitest';
import { handleAuthenticate } from '../../src/entrypoints/http/authenticate-controller.js';
import type { HttpRequest } from '../../src/entrypoints/http/http-contract.js';
import {
  FakeAttemptLimiter,
  FakePasswordVerifier,
  FakeTokenService,
  FakeUserRepository,
  RecordingTelemetry,
  silentLogger,
  userFixture,
} from '../support/fakes.js';

function request(body: unknown): HttpRequest {
  return {
    method: 'POST',
    path: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    sourceIp: '203.0.113.10',
    correlationId: 'trace-123',
  };
}

function deps(overrides = {}) {
  return {
    users: FakeUserRepository.withUser(userFixture()),
    passwords: new FakePasswordVerifier(true),
    tokens: new FakeTokenService(),
    limiter: new FakeAttemptLimiter(),
    logger: silentLogger(),
    telemetry: new RecordingTelemetry(),
    ...overrides,
  };
}

describe('handleAuthenticate — resposta de sucesso', () => {
  it('devolve o contrato da §4.1', async () => {
    const response = await handleAuthenticate(
      request({ cpf: '529.982.247-25', password: 'ok' }),
      deps(),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      accessToken: 'fake-token',
      tokenType: 'Bearer',
      expiresIn: 7200,
    });
  });
});

describe('handleAuthenticate — corpo invalido', () => {
  it.each([
    ['corpo nulo', null],
    ['corpo vazio', ''],
    ['json quebrado', '{'],
    ['json que nao e objeto', '"texto"'],
    ['sem senha', { cpf: '52998224725' }],
    ['sem cpf', { password: 'ok' }],
    ['tipos errados', { cpf: 123, password: true }],
  ])('%s vira 400 INVALID_REQUEST', async (_label, body) => {
    const response = await handleAuthenticate(
      { ...request({}), body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body) },
      deps(),
    );

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toBe('INVALID_REQUEST');
  });
});

describe('handleAuthenticate — mapeamento de erro', () => {
  it('propaga 401 sem revelar se o CPF existe', async () => {
    const response = await handleAuthenticate(
      request({ cpf: '52998224725', password: 'errada' }),
      deps({ users: new FakeUserRepository() }),
    );

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'CPF ou senha invalidos',
      traceId: 'trace-123',
    });
  });

  it('converte falha inesperada em 500 generico', async () => {
    const explodingRepository = {
      findByDocumentNumber: async () => {
        throw new Error('connection terminated: senha do banco expirou');
      },
    };

    const response = await handleAuthenticate(
      request({ cpf: '52998224725', password: 'ok' }),
      deps({ users: explodingRepository }),
    );

    expect(response.status).toBe(500);
    const payload = JSON.parse(response.body);
    expect(payload.error).toBe('INTERNAL_ERROR');
    // O detalhe tecnico fica no log, nunca na resposta.
    expect(payload.message).not.toContain('senha do banco');
  });

  it('inclui o traceId em toda resposta de erro', async () => {
    const response = await handleAuthenticate(request({ cpf: 'x', password: 'y' }), deps());

    expect(JSON.parse(response.body).traceId).toBe('trace-123');
  });
});
