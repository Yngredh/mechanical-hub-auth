import pg from 'pg';
import { InMemoryAttemptLimiter } from '../adapters/ratelimit/in-memory-attempt-limiter.js';
import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/aws-secrets-manager-secret-provider.js';
import { CachedSecretProvider } from '../adapters/secrets/cached-secret-provider.js';
import { EnvironmentSecretProvider } from '../adapters/secrets/environment-secret-provider.js';
import { StructuredLogger } from '../adapters/observability/structured-logger.js';
import { BcryptPasswordVerifier } from '../adapters/security/bcrypt-password-verifier.js';
import { JwtTokenService } from '../adapters/security/jwt-token-service.js';
import { SqlUserRepository } from '../adapters/persistence/sql-user-repository.js';
import type { AttemptLimiter } from '../core/ports/attempt-limiter.js';
import type { Logger } from '../core/ports/logger.js';
import type { PasswordVerifier } from '../core/ports/password-verifier.js';
import type { SecretProvider } from '../core/ports/secret-provider.js';
import type { TokenService } from '../core/ports/token-service.js';
import type { UserRepository } from '../core/ports/user-repository.js';
import { loadConfig, loadTokenConfig, type AppConfig, type SecretProviderKind } from './config.js';

/**
 * Raiz de composicao.
 *
 * Tudo aqui e criado uma vez por instancia de execucao e reaproveitado entre
 * invocacoes -- por isso os handlers importam este modulo no escopo de arquivo,
 * e nao dentro da funcao. Pool de conexao e cache de segredo criados por
 * invocacao seriam a receita para esgotar o banco e triplicar a latencia.
 */

export interface AuthenticationContainer {
  readonly users: UserRepository;
  readonly passwords: PasswordVerifier;
  readonly tokens: TokenService;
  readonly limiter: AttemptLimiter;
  readonly logger: Logger;
}

export interface AuthorizationContainer {
  readonly tokens: TokenService;
  readonly logger: Logger;
}

let authenticationContainer: AuthenticationContainer | null = null;
let authorizationContainer: AuthorizationContainer | null = null;
let pool: pg.Pool | null = null;

export function getAuthenticationContainer(): AuthenticationContainer {
  if (authenticationContainer !== null) return authenticationContainer;

  const config = loadConfig();
  const secrets = buildSecretProvider(config.secretProvider, config.region, config.secretCacheTtlSeconds);
  const logger = buildLogger(config.serviceName, config.logLevel);

  authenticationContainer = {
    users: new SqlUserRepository(getPool(config, secrets)),
    passwords: new BcryptPasswordVerifier(),
    tokens: buildTokenService(config.token, secrets),
    limiter: new InMemoryAttemptLimiter({
      maxFailures: config.maxFailedAttempts,
      windowSeconds: config.failedAttemptsWindowSeconds,
    }),
    logger,
  };

  return authenticationContainer;
}

export function getAuthorizationContainer(): AuthorizationContainer {
  if (authorizationContainer !== null) return authorizationContainer;

  const config = loadTokenConfig();
  const secrets = buildSecretProvider(config.secretProvider, config.region, config.secretCacheTtlSeconds);

  authorizationContainer = {
    tokens: buildTokenService(config.token, secrets),
    logger: buildLogger(config.serviceName, config.logLevel),
  };

  return authorizationContainer;
}

function buildLogger(serviceName: string, logLevel: AppConfig['logLevel']): Logger {
  return new StructuredLogger({ level: logLevel, serviceName });
}

function buildSecretProvider(
  kind: SecretProviderKind,
  region: string | undefined,
  ttlSeconds: number,
): SecretProvider {
  const delegate: SecretProvider =
    kind === 'aws-secrets-manager'
      ? new AwsSecretsManagerSecretProvider(region)
      : new EnvironmentSecretProvider();

  return new CachedSecretProvider(delegate, ttlSeconds);
}

function buildTokenService(token: AppConfig['token'], secrets: SecretProvider): TokenService {
  return new JwtTokenService({
    resolveSigningKey: () => secrets.getSecret(token.signingKeyReference),
    issuer: token.issuer,
    audience: token.audience,
    ttlSeconds: token.ttlSeconds,
  });
}

function getPool(config: AppConfig, secrets: SecretProvider): pg.Pool {
  if (pool !== null) return pool;

  pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    // Sem RDS Proxy no ambiente de lab: o teto baixo de conexoes por instancia
    // e o que segura o consumo do banco sob concorrencia.
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    options: `-c search_path=${config.database.schema}`,
    user: config.database.userReference,
    // O pg aceita funcao assincrona como senha e a resolve a cada conexao nova,
    // o que faz rotacao de segredo funcionar sem reiniciar a instancia.
    password: async () => resolvePassword(config, secrets),
  });

  pool.on('error', () => {
    // Conexao ociosa derrubada pelo banco nao deve derrubar o processo.
  });

  return pool;
}

async function resolvePassword(config: AppConfig, secrets: SecretProvider): Promise<string> {
  if (config.secretProvider === 'environment') {
    return secrets.getSecret(config.database.credentialsReference);
  }

  const credentials = await secrets.getSecretAsJson<{ password: string }>(
    config.database.credentialsReference,
  );

  return credentials.password;
}

/** Usado apenas em teste, para nao vazar estado entre casos. */
export function resetContainers(): void {
  authenticationContainer = null;
  authorizationContainer = null;
  pool = null;
}
