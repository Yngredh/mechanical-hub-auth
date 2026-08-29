/**
 * Configuracao de telemetria (RFC-0004, etapa 3).
 *
 * Fica num modulo proprio, e nao dentro de config.ts, porque vale para as duas
 * funcoes — a de login, que le DATABASE_*, e a autorizadora, que nao le. Juntar
 * tudo em loadConfig obrigaria o autorizador a conhecer configuracao de banco,
 * exatamente o acoplamento que loadTokenConfig existe para evitar.
 */

export interface TelemetryConfig {
  /** Falso desliga tudo: o adaptador vira no-op e nada sai da funcao. */
  readonly enabled: boolean;
  /** Raiz OTLP/HTTP do coletor, sem sufixo de sinal. */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly environment: string;
  readonly timeoutMs: number;
}

export function loadTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
  serviceName = 'mechanical-hub-auth',
): TelemetryConfig {
  const endpoint = normalizeEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT);

  return {
    // Sem endereco nao ha para onde exportar. Deixar ligado apontando para
    // lugar nenhum so produziria um timeout por invocacao — custo real, zero
    // beneficio. E o que mantem `npm test` e execucao local funcionando sem
    // coletor.
    enabled: endpoint !== '' && readBoolean(env.OTEL_ENABLED, true),
    endpoint,
    serviceName: env.SERVICE_NAME ?? serviceName,
    environment: env.ENVIRONMENT ?? 'production',
    // Curto de proposito: o flush entra no tempo de resposta da requisicao. Vale
    // perder telemetria de uma invocacao lenta, nao atrasar o login por causa
    // dela.
    timeoutMs: readNumber(env.OTEL_EXPORT_TIMEOUT_MS, 1500),
  };
}

/** Remove a barra final para que a concatenacao com /v1/... nao gere `//`. */
function normalizeEndpoint(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';

  const trimmed = raw.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}
