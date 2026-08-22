import type { LogLevel } from '../core/ports/logger.js';

/**
 * Unico ponto do projeto que le variaveis de ambiente.
 *
 * Concentrar aqui deixa explicito o que a funcao precisa para subir e evita
 * que adaptadores fiquem espalhando process.env por toda parte.
 */

export type SecretProviderKind = 'environment' | 'aws-secrets-manager';

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly schema: string;
  readonly ssl: boolean;
  /** Referencia resolvida pelo SecretProvider (nome da env var ou id do segredo). */
  readonly credentialsReference: string;
  /** Usado apenas com o provider de ambiente. */
  readonly userReference: string;
}

export interface TokenConfig {
  readonly signingKeyReference: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}

export interface AppConfig {
  readonly serviceName: string;
  readonly logLevel: LogLevel;
  readonly secretProvider: SecretProviderKind;
  readonly secretCacheTtlSeconds: number;
  readonly region: string | undefined;
  readonly database: DatabaseConfig;
  readonly token: TokenConfig;
  readonly maxFailedAttempts: number;
  readonly failedAttemptsWindowSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secretProvider = readSecretProviderKind(env.SECRET_PROVIDER);

  return {
    serviceName: env.SERVICE_NAME ?? 'mechanical-hub-auth',
    logLevel: readLogLevel(env.LOG_LEVEL),
    secretProvider,
    secretCacheTtlSeconds: readNumber(env.SECRET_CACHE_TTL_SECONDS, 900),
    region: env.AWS_REGION,
    database: {
      host: required(env, 'DATABASE_HOST'),
      port: readNumber(env.DATABASE_PORT, 5432),
      database: required(env, 'DATABASE_NAME'),
      schema: env.DATABASE_SCHEMA ?? 'public',
      ssl: readBoolean(env.DATABASE_SSL, false),
      credentialsReference:
        secretProvider === 'environment'
          ? 'DATABASE_PASSWORD'
          : required(env, 'DATABASE_CREDENTIALS_SECRET_ID'),
      userReference: env.DATABASE_USER ?? 'lambda_auth',
    },
    token: {
      signingKeyReference:
        secretProvider === 'environment'
          ? 'TOKEN_SIGNING_KEY'
          : required(env, 'TOKEN_SIGNING_KEY_SECRET_ID'),
      issuer: env.TOKEN_ISSUER ?? 'mechanical-hub-auth',
      audience: env.TOKEN_AUDIENCE ?? 'mechanical-hub-api',
      ttlSeconds: readNumber(env.TOKEN_TTL_SECONDS, 7200),
    },
    maxFailedAttempts: readNumber(env.MAX_FAILED_ATTEMPTS, 5),
    failedAttemptsWindowSeconds: readNumber(env.FAILED_ATTEMPTS_WINDOW_SECONDS, 900),
  };
}

/**
 * Configuracao minima do autorizador: ele nao fala com o banco, entao exigir
 * DATABASE_* dele seria acoplamento desnecessario.
 */
export function loadTokenConfig(env: NodeJS.ProcessEnv = process.env): {
  serviceName: string;
  logLevel: LogLevel;
  secretProvider: SecretProviderKind;
  secretCacheTtlSeconds: number;
  region: string | undefined;
  token: TokenConfig;
} {
  const secretProvider = readSecretProviderKind(env.SECRET_PROVIDER);

  return {
    serviceName: env.SERVICE_NAME ?? 'mechanical-hub-auth',
    logLevel: readLogLevel(env.LOG_LEVEL),
    secretProvider,
    secretCacheTtlSeconds: readNumber(env.SECRET_CACHE_TTL_SECONDS, 900),
    region: env.AWS_REGION,
    token: {
      signingKeyReference:
        secretProvider === 'environment'
          ? 'TOKEN_SIGNING_KEY'
          : required(env, 'TOKEN_SIGNING_KEY_SECRET_ID'),
      issuer: env.TOKEN_ISSUER ?? 'mechanical-hub-auth',
      audience: env.TOKEN_AUDIENCE ?? 'mechanical-hub-api',
      ttlSeconds: readNumber(env.TOKEN_TTL_SECONDS, 7200),
    },
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
  }

  return value;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function readLogLevel(raw: string | undefined): LogLevel {
  const allowed: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
  return allowed.includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

function readSecretProviderKind(raw: string | undefined): SecretProviderKind {
  return raw === 'aws-secrets-manager' ? 'aws-secrets-manager' : 'environment';
}
