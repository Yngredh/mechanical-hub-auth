import { describe, expect, it } from 'vitest';
import { normalizePath, resolveAccess } from '../../src/core/domain/access-policy.js';

describe('resolveAccess — rotas publicas', () => {
  it.each([
    ['/auth/login', 'POST'],
    ['/actuator/health', 'GET'],
    ['/actuator/health/readiness', 'GET'],
    ['/swagger-ui/index.html', 'GET'],
    ['/v3/api-docs', 'GET'],
    ['/mechanical-hub/service-orders/OS-2026-001', 'GET'],
    ['/mechanical-hub/service-orders/OS-2026-001/approve', 'POST'],
    ['/mechanical-hub/service-orders/OS-2026-001/reject', 'POST'],
  ])('%s %s nao exige token', (path, method) => {
    expect(resolveAccess(path, method).kind).toBe('PUBLIC');
  });
});

describe('resolveAccess — rotas exclusivas do administrador', () => {
  it.each([
    '/users',
    '/users/11111111-1111-4111-8111-111111111111',
    '/customers/1',
    '/vehicles/1',
    '/services/1',
    '/materials/1',
    '/stock/1',
    '/reports/average-execution-time',
  ])('%s exige ADMINISTRATOR', (path) => {
    const decision = resolveAccess(path, 'GET');

    expect(decision.kind).toBe('REQUIRES_ROLE');
    if (decision.kind === 'REQUIRES_ROLE') {
      expect(decision.roles).toEqual(['ADMINISTRATOR']);
    }
  });
});

describe('resolveAccess — ordens de servico', () => {
  it.each(['/service-orders', '/service-orders/1', '/service-orders/1/tasks'])(
    '%s aceita mecanico e administrador',
    (path) => {
      const decision = resolveAccess(path, 'POST');

      expect(decision.kind).toBe('REQUIRES_ROLE');
      if (decision.kind === 'REQUIRES_ROLE') {
        expect([...decision.roles].sort()).toEqual(['ADMINISTRATOR', 'MECHANICAL']);
      }
    },
  );

  it('nao confunde a rota publica do cliente com a rota interna', () => {
    expect(resolveAccess('/mechanical-hub/service-orders/1', 'GET').kind).toBe('PUBLIC');
    expect(resolveAccess('/service-orders/1', 'GET').kind).toBe('REQUIRES_ROLE');
  });
});

describe('resolveAccess — default deny', () => {
  it.each(['/rota-inexistente', '/admin', '/', '/auth', '/auth/register'])('%s cai em UNKNOWN_ROUTE', (path) => {
    expect(resolveAccess(path, 'GET').kind).toBe('UNKNOWN_ROUTE');
  });

  it('metodo fora da regra nao herda a permissao', () => {
    expect(resolveAccess('/auth/login', 'GET').kind).toBe('UNKNOWN_ROUTE');
  });

  it('o cadastro de funcionario mora em /users/register, nao em /auth/register', () => {
    const decision = resolveAccess('/users/register', 'POST');

    expect(decision.kind).toBe('REQUIRES_ROLE');
    if (decision.kind === 'REQUIRES_ROLE') {
      expect(decision.roles).toEqual(['ADMINISTRATOR']);
    }
  });
});

describe('normalizePath', () => {
  it('descarta query string e barra final', () => {
    expect(normalizePath('/users/?page=1')).toBe('/users');
    expect(normalizePath('/users/')).toBe('/users');
    expect(normalizePath('users')).toBe('/users');
    expect(normalizePath('/')).toBe('/');
  });
});
