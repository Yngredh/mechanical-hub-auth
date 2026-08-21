import type { AuthenticatableUser } from '../../src/core/domain/user.js';
import type { AttemptLimiter } from '../../src/core/ports/attempt-limiter.js';
import type { LogFields, Logger } from '../../src/core/ports/logger.js';
import type { PasswordVerifier } from '../../src/core/ports/password-verifier.js';
import type {
  AccessTokenClaims,
  IssuedToken,
  TokenService,
  TokenVerificationResult,
} from '../../src/core/ports/token-service.js';
import type { UserRepository } from '../../src/core/ports/user-repository.js';

export function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    withContext: (_fields: LogFields) => logger,
  };

  return logger;
}

export function userFixture(overrides: Partial<AuthenticatableUser> = {}): AuthenticatableUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Maria Silva',
    documentNumber: '52998224725',
    passwordHash: '$2a$10$hash',
    role: 'ADMINISTRATOR',
    deletedAt: null,
    ...overrides,
  };
}

export class FakeUserRepository implements UserRepository {
  constructor(private readonly users: Map<string, AuthenticatableUser> = new Map()) {}

  static withUser(user: AuthenticatableUser): FakeUserRepository {
    return new FakeUserRepository(new Map([[user.documentNumber, user]]));
  }

  async findByDocumentNumber(documentNumber: string): Promise<AuthenticatableUser | null> {
    return this.users.get(documentNumber) ?? null;
  }
}

export class FakePasswordVerifier implements PasswordVerifier {
  timeConsumed = 0;

  constructor(private readonly matches: boolean) {}

  async verify(): Promise<boolean> {
    return this.matches;
  }

  async consumeTime(): Promise<void> {
    this.timeConsumed += 1;
  }
}

export class FakeTokenService implements TokenService {
  issuedFor: AccessTokenClaims | null = null;

  constructor(private readonly verification?: TokenVerificationResult) {}

  async issue(claims: AccessTokenClaims): Promise<IssuedToken> {
    this.issuedFor = claims;
    return { token: 'fake-token', expiresInSeconds: 7200 };
  }

  async verify(): Promise<TokenVerificationResult> {
    return this.verification ?? { valid: false, reason: 'MALFORMED' };
  }
}

export class FakeAttemptLimiter implements AttemptLimiter {
  failures = 0;
  resets = 0;

  constructor(private blocked = false) {}

  async isBlocked(): Promise<boolean> {
    return this.blocked;
  }

  async registerFailure(): Promise<void> {
    this.failures += 1;
  }

  async reset(): Promise<void> {
    this.resets += 1;
  }
}
