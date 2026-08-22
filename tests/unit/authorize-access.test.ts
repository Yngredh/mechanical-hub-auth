import { describe, expect, it } from 'vitest';
import { authorizeAccess, extractBearerToken } from '../../src/core/usecases/authorize-access.js';
import type { AccessTokenClaims } from '../../src/core/ports/token-service.js';
import { FakeTokenService, silentLogger } from '../support/fakes.js';

function claims(role: AccessTokenClaims['role']): AccessTokenClaims {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    name: 'Maria Silva',
    documentNumber: '52998224725',
    role,
  };
}

function depsWithValidToken(role: AccessTokenClaims['role']) {
  return {
    tokens: new FakeTokenService({ valid: true, claims: claims(role) }),
    logger: silentLogger(),
  };
}

describe('authorizeAccess — rotas publicas', () => {
  it('libera sem token', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: null, path: '/mechanical-hub/service-orders/OS-1', method: 'GET' },
      { tokens: new FakeTokenService(), logger: silentLogger() },
    );

    expect(outcome.effect).toBe('ALLOW_ANONYMOUS');
  });
});

describe('authorizeAccess — token ausente ou malformado', () => {
  it('nega com 401 quando nao ha cabecalho', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: null, path: '/service-orders', method: 'GET' },
      { tokens: new FakeTokenService(), logger: silentLogger() },
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 401, reason: 'MISSING_TOKEN' });
  });

  it('nega com 401 quando o cabecalho nao usa Bearer', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Basic abc', path: '/service-orders', method: 'GET' },
      { tokens: new FakeTokenService(), logger: silentLogger() },
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 401, reason: 'MALFORMED_HEADER' });
  });
});

describe('authorizeAccess — token invalido', () => {
  it('nega com 401 quando o token expirou', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/service-orders', method: 'GET' },
      { tokens: new FakeTokenService({ valid: false, reason: 'EXPIRED' }), logger: silentLogger() },
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 401, reason: 'EXPIRED_TOKEN' });
  });

  it('nega com 401 quando a assinatura nao confere', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/service-orders', method: 'GET' },
      {
        tokens: new FakeTokenService({ valid: false, reason: 'INVALID_SIGNATURE' }),
        logger: silentLogger(),
      },
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 401, reason: 'INVALID_TOKEN' });
  });
});

describe('authorizeAccess — perfil', () => {
  it('libera administrador em rota administrativa', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/customers/1', method: 'GET' },
      depsWithValidToken('ADMINISTRATOR'),
    );

    expect(outcome.effect).toBe('ALLOW');
  });

  it('nega mecanico em rota administrativa com 403', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/customers/1', method: 'GET' },
      depsWithValidToken('MECHANICAL'),
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 403, reason: 'INSUFFICIENT_ROLE' });
  });

  it('libera mecanico em ordens de servico', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/service-orders/1', method: 'PATCH' },
      depsWithValidToken('MECHANICAL'),
    );

    expect(outcome.effect).toBe('ALLOW');
  });
});

describe('authorizeAccess — rota desconhecida', () => {
  it('nega mesmo com token valido de administrador', async () => {
    const outcome = await authorizeAccess(
      { authorizationHeader: 'Bearer abc', path: '/rota-nova', method: 'GET' },
      depsWithValidToken('ADMINISTRATOR'),
    );

    expect(outcome).toMatchObject({ effect: 'DENY', status: 403, reason: 'UNKNOWN_ROUTE' });
  });
});

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['  Bearer   abc  ', 'abc'],
  ])('extrai o token de %s', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });

  it.each([null, undefined, '', 'Bearer', 'Bearer   ', 'Basic abc'])(
    'retorna null para %s',
    (header) => {
      expect(extractBearerToken(header as string | null | undefined)).toBeNull();
    },
  );
});
