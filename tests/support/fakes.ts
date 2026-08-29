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
import type {
  MetricAttributes,
  Span,
  SpanOptions,
  Telemetry,
  TraceContext,
} from '../../src/core/ports/telemetry.js';
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

/**
 * Telemetria de teste: guarda o que foi contado em vez de exportar.
 *
 * O controlador e os handlers passaram a exigir esta porta, entao ela precisa
 * existir em qualquer construcao de dependencias — inclusive nos testes que nao
 * se importam com metrica.
 */
export class RecordingTelemetry implements Telemetry {
  readonly counters: Array<{ name: string; attributes: MetricAttributes; value: number }> = [];
  readonly spans: Array<{ name: string; context: TraceContext; error?: string }> = [];
  flushes = 0;

  increment(name: string, attributes: MetricAttributes = {}, value = 1): void {
    this.counters.push({ name, attributes, value });
  }

  startSpan(options: SpanOptions, parent?: TraceContext): Span {
    const context: TraceContext = {
      traceId: parent?.traceId ?? 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      sampled: parent?.sampled ?? true,
    };

    const spans = this.spans;

    return {
      context,
      end(outcome): void {
        spans.push({ name: options.name, context, error: outcome?.error });
      },
    };
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  /** Total contado sob um nome, opcionalmente filtrando por uma etiqueta. */
  totalFor(name: string, attribute?: readonly [string, string]): number {
    return this.counters
      .filter((counter) => counter.name === name)
      .filter((counter) => attribute === undefined || counter.attributes[attribute[0]] === attribute[1])
      .reduce((sum, counter) => sum + counter.value, 0);
  }
}
