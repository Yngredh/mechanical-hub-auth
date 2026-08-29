import type { LogFields, LogLevel, Logger } from '../../core/ports/logger.js';
import type { MetricAttributes } from '../../core/ports/telemetry.js';

/** O que o TelemetryLogger precisa do adaptador OTLP — nada alem disto. */
export interface LogRecorder {
  record(log: {
    level: LogLevel;
    body: string;
    attributes?: MetricAttributes;
    traceId?: string;
    spanId?: string;
  }): void;
}

/**
 * Decorador que duplica cada evento de log para o coletor OpenTelemetry.
 *
 * Por que duplicar, se o CloudWatch ja recebe tudo: as funcoes nao sao pods, e
 * por isso o agente que recolhe log de `/var/log/pods` — o que leva os logs da
 * aplicacao ao Loki — nao as enxerga. Sem este caminho, os logs das Lambdas
 * ficariam presos no CloudWatch, fora do Grafana, e o salto de um trace para as
 * linhas daquela requisicao pararia na fronteira da autenticacao.
 *
 * O stdout continua sendo escrito normalmente: o CloudWatch segue como a fonte
 * que nao depende de o coletor estar de pe.
 */
export class TelemetryLogger implements Logger {
  private readonly delegate: Logger;
  private readonly recorder: LogRecorder;
  private readonly context: LogFields;

  constructor(delegate: Logger, recorder: LogRecorder, context: LogFields = {}) {
    this.delegate = delegate;
    this.recorder = recorder;
    this.context = context;
  }

  debug(event: string, fields?: LogFields): void {
    this.delegate.debug(event, fields);
    this.forward('debug', event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.delegate.info(event, fields);
    this.forward('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.delegate.warn(event, fields);
    this.forward('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.delegate.error(event, fields);
    this.forward('error', event, fields);
  }

  withContext(fields: LogFields): Logger {
    return new TelemetryLogger(this.delegate.withContext(fields), this.recorder, {
      ...this.context,
      ...fields,
    });
  }

  private forward(level: LogLevel, event: string, fields?: LogFields): void {
    const merged = { ...this.context, ...fields };

    // trace_id e span_id saem dos atributos e viram campo de primeira classe do
    // registro OTLP: e assim que o Grafana liga a linha de log ao span no Tempo.
    const traceId = readId(merged.trace_id);
    const spanId = readId(merged.span_id);

    this.recorder.record({
      level,
      body: event,
      attributes: toStringAttributes(merged),
      traceId,
      spanId,
    });
  }
}

function readId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Atributos OTLP sao tipados; aqui tudo vira string.
 *
 * Objetos aninhados sao serializados em vez de descartados — um campo que
 * aparece como `[object Object]` no Grafana e pior do que um JSON legivel.
 */
function toStringAttributes(fields: LogFields): MetricAttributes {
  const attributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    attributes[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  return attributes;
}
