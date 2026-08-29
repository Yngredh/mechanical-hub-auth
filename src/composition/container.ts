import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { InMemoryAttemptLimiter } from '../adapters/ratelimit/in-memory-attempt-limiter.js';
import { AwsSecretsManagerSecretProvider } from '../adapters/secrets/aws-secrets-manager-secret-provider.js';
import { CachedSecretProvider } from '../adapters/secrets/cached-secret-provider.js';
import { EnvironmentSecretProvider } from '../adapters/secrets/environment-secret-provider.js';
import { StructuredLogger } from '../adapters/observability/structured-logger.js';
import { NoopTelemetry, OtlpTelemetry } from '../adapters/observability/otlp-telemetry.js';
import { TelemetryLogger } from '../adapters/observability/telemetry-logger.js';
import { BcryptPasswordVerifier } from '../adapters/security/bcrypt-password-verifier.js';
import { JwtTokenService } from '../adapters/security/jwt-token-service.js';
import { SqlUserRepository } from '../adapters/persistence/sql-user-repository.js';
import type { AttemptLimiter } from '../core/ports/attempt-limiter.js';
import type { Logger } from '../core/ports/logger.js';
import type { PasswordVerifier } from '../core/ports/password-verifier.js';
import type { SecretProvider } from '../core/ports/secret-provider.js';
import type { Telemetry } from '../core/ports/telemetry.js';
import type { TokenService } from '../core/ports/token-service.js';
import type { UserRepository } from '../core/ports/user-repository.js';
import { loadConfig, loadTokenConfig, type AppConfig, type SecretProviderKind } from './config.js';
import { loadTelemetryConfig, type TelemetryConfig } from './telemetry-config.js';

/**
 * Raiz de composicao.
 *
 * Tudo aqui e criado uma vez por instancia de execucao e reaproveitado entre
 * invocacoes -- por isso os handlers importam este modulo no escopo de arquivo,
 * e nao dentro da funcao. Pool de conexao e cache de segredo criados por
 * invocacao seriam a receita para esgotar o banco e triplicar a latencia.
 *
 * O mesmo vale para a telemetria: os contadores sao cumulativos e vivem junto
 * da instancia. Recria-los por invocacao produziria uma serie que reinicia do
 * zero a cada requisicao.
 */

export interface AuthenticationContainer {
  readonly users: UserRepository;
  readonly passwords: PasswordVerifier;
  readonly tokens: TokenService;
  readonly limiter: AttemptLimiter;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}

export interface AuthorizationContainer {
  readonly tokens: TokenService;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}

let authenticationContainer: AuthenticationContainer | null = null;
let authorizationContainer: AuthorizationContainer | null = null;
let pool: pg.Pool | null = null;

/**
 * Identifica esta instancia de execucao para o resto da vida dela.
 *
 * Entra como `service.instance.id` nas metricas. Sem isso, duas instancias
 * concorrentes publicariam contadores cumulativos sob as mesmas etiquetas e a
 * serie andaria para tras no Prometheus.
 */
const INSTANCE_ID = randomUUID();

export function getAuthenticationContainer(): AuthenticationContainer {
  if (authenticationContainer !== null) return authenticationContainer;

  const config = loadConfig();
  const secrets = buildSecretProvider(config.secretProvider, config.region, config.secretCacheTtlSeconds);
  const telemetryConfig = loadTelemetryConfig(process.env, config.serviceName);
  const telemetry = buildTelemetry(telemetryConfig);

  authenticationContainer = {
    users: new SqlUserRepository(getPool(config, secrets)),
    passwords: new BcryptPasswordVerifier(),
    tokens: buildTokenService(config.token, secrets),
    limiter: new InMemoryAttemptLimiter({
      maxFailures: config.maxFailedAttempts,
      windowSeconds: config.failedAttemptsWindowSeconds,
    }),
    logger: buildLogger(config.serviceName, config.logLevel, telemetry),
    telemetry,
  };

  return authenticationContainer;
}

export function getAuthorizationContainer(): AuthorizationContainer {
  if (authorizationContainer !== null) return authorizationContainer;

  const config = loadTokenConfig();
  const secrets = buildSecretProvider(config.secretProvider, config.region, config.secretCacheTtlSeconds);
  const telemetryConfig = loadTelemetryConfig(process.env, config.serviceName);
  const telemetry = buildTelemetry(telemetryConfig);

  authorizationContainer = {
    tokens: buildTokenService(config.token, secrets),
    logger: buildLogger(config.serviceName, config.logLevel, telemetry),
    telemetry,
  };

  return authorizationContainer;
}

function buildTelemetry(config: TelemetryConfig): Telemetry {
  if (!config.enabled) return new NoopTelemetry();

  return new OtlpTelemetry({
    endpoint: config.endpoint,
    serviceName: config.serviceName,
    environment: config.environment,
    instanceId: INSTANCE_ID,
    timeoutMs: config.timeoutMs,
    // Falha de exportacao vai para stdout e para no CloudWatch. Nao pode virar
    // log estruturado pelo mesmo caminho, sob risco de laco: um erro de envio
    // geraria um registro que tambem seria enviado.
    onError: (message) => process.stderr.write(`${message}\n`),
  });
}

/**
 * O logger sempre escreve em stdout; quando ha coletor, tambem entrega ao OTLP.
 *
 * As funcoes nao sao pods, entao o agente que leva os logs da aplicacao ao Loki
 * nao as alcanca. Sem este segundo caminho, os logs das Lambdas ficariam so no
 * CloudWatch, fora do Grafana.
 */
function buildLogger(serviceName: string, logLevel: AppConfig['logLevel'], telemetry: Telemetry): Logger {
  const base = new StructuredLogger({ level: logLevel, serviceName });

  return telemetry instanceof OtlpTelemetry ? new TelemetryLogger(base, telemetry) : base;
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
