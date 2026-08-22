import { describe, expect, it } from 'vitest';
import { AuthError } from '../../src/core/domain/errors.js';
import { authenticateUser } from '../../src/core/usecases/authenticate-user.js';
import {
  FakeAttemptLimiter,
  FakePasswordVerifier,
  FakeTokenService,
  FakeUserRepository,
  silentLogger,
  userFixture,
} from '../support/fakes.js';

const VALID_DOCUMENT = '52998224725';

function deps(overrides: Partial<Parameters<typeof authenticateUser>[1]> = {}) {
  return {
    users: FakeUserRepository.withUser(userFixture()),
    passwords: new FakePasswordVerifier(true),
    tokens: new FakeTokenService(),
    limiter: new FakeAttemptLimiter(),
    logger: silentLogger(),
    ...overrides,
  };
}

async function expectAuthError(promise: Promise<unknown>, code: string, status: number) {
  await expect(promise).rejects.toBeInstanceOf(AuthError);
  await promise.catch((error: AuthError) => {
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });
}

describe('authenticateUser — caminho feliz', () => {
  it('emite token com as claims do usuario', async () => {
    const tokens = new FakeTokenService();

    const issued = await authenticateUser(
      { documentNumber: '529.982.247-25', password: 'senha-valida' },
      deps({ tokens }),
    );

    expect(issued.token).toBe('fake-token');
    expect(tokens.issuedFor).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      name: 'Maria Silva',
      documentNumber: VALID_DOCUMENT,
      role: 'ADMINISTRATOR',
    });
  });

  it('zera o contador de tentativas apos sucesso', async () => {
    const limiter = new FakeAttemptLimiter();

    await authenticateUser({ documentNumber: VALID_DOCUMENT, password: 'ok' }, deps({ limiter }));

    expect(limiter.resets).toBe(1);
  });
});

describe('authenticateUser — validacao de entrada', () => {
  it('rejeita campos ausentes com 400', async () => {
    await expectAuthError(
      authenticateUser({ documentNumber: undefined as unknown as string, password: 'x' }, deps()),
      'INVALID_REQUEST',
      400,
    );
  });

  it('rejeita senha vazia com 400', async () => {
    await expectAuthError(
      authenticateUser({ documentNumber: VALID_DOCUMENT, password: '' }, deps()),
      'INVALID_REQUEST',
      400,
    );
  });

  it('rejeita senha acima do limite do bcrypt com 400', async () => {
    await expectAuthError(
      authenticateUser({ documentNumber: VALID_DOCUMENT, password: 'a'.repeat(73) }, deps()),
      'INVALID_REQUEST',
      400,
    );
  });

  it('rejeita CPF invalido com 400 antes de tocar o banco', async () => {
    const users = new FakeUserRepository();

    await expectAuthError(
      authenticateUser({ documentNumber: '11111111111', password: 'x' }, deps({ users })),
      'INVALID_CPF',
      400,
    );
  });
});

describe('authenticateUser — credenciais', () => {
  it('responde 401 para documento inexistente', async () => {
    await expectAuthError(
      authenticateUser(
        { documentNumber: VALID_DOCUMENT, password: 'x' },
        deps({ users: new FakeUserRepository() }),
      ),
      'INVALID_CREDENTIALS',
      401,
    );
  });

  it('gasta tempo de bcrypt mesmo quando o documento nao existe', async () => {
    const passwords = new FakePasswordVerifier(true);

    await authenticateUser(
      { documentNumber: VALID_DOCUMENT, password: 'x' },
      deps({ users: new FakeUserRepository(), passwords }),
    ).catch(() => undefined);

    expect(passwords.timeConsumed).toBe(1);
  });

  it('responde 401 para senha incorreta', async () => {
    await expectAuthError(
      authenticateUser(
        { documentNumber: VALID_DOCUMENT, password: 'errada' },
        deps({ passwords: new FakePasswordVerifier(false) }),
      ),
      'INVALID_CREDENTIALS',
      401,
    );
  });

  it('registra falha no limitador quando a senha esta errada', async () => {
    const limiter = new FakeAttemptLimiter();

    await authenticateUser(
      { documentNumber: VALID_DOCUMENT, password: 'errada' },
      deps({ passwords: new FakePasswordVerifier(false), limiter }),
    ).catch(() => undefined);

    expect(limiter.failures).toBe(1);
  });
});

describe('authenticateUser — usuario desativado', () => {
  it('responde 403 quando deleted_at esta preenchido', async () => {
    const users = FakeUserRepository.withUser(userFixture({ deletedAt: new Date('2026-01-01') }));

    await expectAuthError(
      authenticateUser({ documentNumber: VALID_DOCUMENT, password: 'ok' }, deps({ users })),
      'USER_INACTIVE',
      403,
    );
  });

  it('so avalia atividade depois da senha, para nao revelar cadastro', async () => {
    const users = FakeUserRepository.withUser(userFixture({ deletedAt: new Date('2026-01-01') }));

    await expectAuthError(
      authenticateUser(
        { documentNumber: VALID_DOCUMENT, password: 'errada' },
        deps({ users, passwords: new FakePasswordVerifier(false) }),
      ),
      'INVALID_CREDENTIALS',
      401,
    );
  });
});

describe('authenticateUser — forca bruta', () => {
  it('responde 429 quando o limitador bloqueia', async () => {
    await expectAuthError(
      authenticateUser(
        { documentNumber: VALID_DOCUMENT, password: 'ok' },
        deps({ limiter: new FakeAttemptLimiter(true) }),
      ),
      'TOO_MANY_ATTEMPTS',
      429,
    );
  });
});
