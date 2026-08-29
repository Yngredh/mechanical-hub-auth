import type {
  MetricAttributes,
  Span,
  SpanOptions,
  Telemetry,
  TraceContext,
} from '../../core/ports/telemetry.js';
import type { LogLevel } from '../../core/ports/logger.js';
import { newSpanId, startNewTrace } from './trace-context.js';

/**
 * Exportador OTLP sobre HTTP, em JSON.
 *
 * Escrito a mao, sem os pacotes @opentelemetry/*, pela mesma razao que o
 * StructuredLogger nao usa biblioteca de log: o SDK completo entraria no bundle
 * das duas funcoes para, na pratica, serializar tres payloads JSON e fazer um
 * POST. No caminho do login isso e cold start puro. A codificacao JSON e parte
 * do proprio padrao OTLP, entao o coletor aceita sem nenhuma configuracao
 * especial.
 *
 * Duas garantias que valem mais que qualquer metrica:
 *
 *   1. Nada aqui lanca para fora. `increment` e `startSpan` sao sincronos e
 *      apenas guardam em memoria; `flush` engole a propria falha. Uma
 *      indisponibilidade do coletor nao pode derrubar o login.
 *
 *   2. `flush` tem prazo. A Lambda congela assim que responde, entao o envio
 *      precisa caber antes disso — e nao pode virar o gargalo da requisicao.
 */

/** AGGREGATION_TEMPORALITY_CUMULATIVE, conforme a especificacao OTLP. */
const CUMULATIVE = 2;

/** SPAN_KIND_SERVER. */
const SPAN_KIND_SERVER = 2;

const STATUS_UNSET = 0;
const STATUS_ERROR = 2;

const SEVERITY_NUMBER: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

export interface OtlpTelemetryOptions {
  /** Raiz OTLP/HTTP do coletor, sem o sufixo de sinal. Ex: http://host:4318 */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly environment: string;
  /**
   * Identifica esta instancia de execucao.
   *
   * Sem ele, duas instancias concorrentes publicariam contadores cumulativos
   * sob exatamente as mesmas etiquetas, sobrescrevendo uma a outra e gerando
   * uma serie que anda para tras. Com ele, cada instancia tem a sua serie e o
   * Prometheus soma corretamente.
   */
  readonly instanceId: string;
  readonly timeoutMs: number;
  /** Injetavel para teste. */
  readonly fetchImpl?: typeof fetch;
  /** Para onde reportar falha de envio. Injetavel para teste. */
  readonly onError?: (message: string) => void;
  readonly now?: () => number;
}

interface CounterState {
  readonly name: string;
  readonly attributes: MetricAttributes;
  value: number;
}

interface FinishedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startNano: bigint;
  readonly endNano: bigint;
  readonly attributes: MetricAttributes;
  readonly error?: string;
}

interface BufferedLog {
  readonly timeNano: bigint;
  readonly level: LogLevel;
  readonly body: string;
  readonly attributes: MetricAttributes;
  readonly traceId?: string;
  readonly spanId?: string;
}

export class OtlpTelemetry implements Telemetry {
  private readonly options: OtlpTelemetryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly onError: (message: string) => void;
  private readonly now: () => number;

  /**
   * Contadores cumulativos, vivos enquanto a instancia viver. Chave inclui as
   * etiquetas, para que cada combinacao tenha a sua propria serie.
   */
  private readonly counters = new Map<string, CounterState>();

  /** Instante em que a instancia comecou — o `startTimeUnixNano` das series. */
  private readonly startNano: bigint;

  private spans: FinishedSpan[] = [];
  private logs: BufferedLog[] = [];

  constructor(options: OtlpTelemetryOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onError = options.onError ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.startNano = toNano(this.now());
  }

  increment(name: string, attributes: MetricAttributes = {}, value = 1): void {
    const key = `${name}|${stableKey(attributes)}`;
    const existing = this.counters.get(key);

    if (existing === undefined) {
      this.counters.set(key, { name, attributes, value });
      return;
    }

    existing.value += value;
  }

  startSpan(options: SpanOptions, parent?: TraceContext): Span {
    const context: TraceContext =
      parent === undefined
        ? startNewTrace()
        : { traceId: parent.traceId, spanId: newSpanId(), sampled: parent.sampled };

    const startNano = toNano(this.now());
    const self = this;

    return {
      context,
      end(outcome): void {
        self.spans.push({
          traceId: context.traceId,
          spanId: context.spanId,
          parentSpanId: parent?.spanId,
          name: options.name,
          startNano,
          endNano: toNano(self.now()),
          attributes: { ...options.attributes, ...outcome?.attributes },
          error: outcome?.error,
        });
      },
    };
  }

  /** Registra um log para envio ao coletor, alem do stdout. */
  record(log: {
    level: LogLevel;
    body: string;
    attributes?: MetricAttributes;
    traceId?: string;
    spanId?: string;
  }): void {
    this.logs.push({
      timeNano: toNano(this.now()),
      level: log.level,
      body: log.body,
      attributes: log.attributes ?? {},
      traceId: log.traceId,
      spanId: log.spanId,
    });
  }

  async flush(): Promise<void> {
    const spans = this.spans;
    const logs = this.logs;
    // Zera antes de enviar: se o envio falhar, o proximo flush nao repete os
    // mesmos spans. Metrica cumulativa nao e zerada — e justamente o acumulado
    // que precisa continuar subindo.
    this.spans = [];
    this.logs = [];

    const payloads: Array<readonly [string, unknown]> = [];

    if (this.counters.size > 0) payloads.push(['/v1/metrics', this.metricsPayload()]);
    if (spans.length > 0) payloads.push(['/v1/traces', this.tracesPayload(spans)]);
    if (logs.length > 0) payloads.push(['/v1/logs', this.logsPayload(logs)]);

    if (payloads.length === 0) return;

    await Promise.all(payloads.map(([path, body]) => this.post(path, body)));
  }

  private async post(path: string, body: unknown): Promise<void> {
    try {
      const response = await this.fetchImpl(`${this.options.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      if (!response.ok) {
        this.onError(`OTLP ${path} respondeu ${response.status}`);
      }
    } catch (error) {
      // Coletor fora do ar, timeout, DNS. Nada disso pode escapar daqui: a
      // requisicao do usuario ja foi atendida e nao deve falhar por telemetria.
      this.onError(`OTLP ${path} falhou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private resource(): unknown {
    return {
      attributes: attributesOf({
        'service.name': this.options.serviceName,
        'service.instance.id': this.options.instanceId,
        'deployment.environment': this.options.environment,
      }),
    };
  }

  private metricsPayload(): unknown {
    const nowNano = toNano(this.now());

    // Uma entrada de `metrics` por nome; as combinacoes de etiqueta viram
    // dataPoints daquele nome, que e como o OTLP espera receber.
    const byName = new Map<string, CounterState[]>();
    for (const counter of this.counters.values()) {
      const bucket = byName.get(counter.name);
      if (bucket === undefined) byName.set(counter.name, [counter]);
      else bucket.push(counter);
    }

    return {
      resourceMetrics: [
        {
          resource: this.resource(),
          scopeMetrics: [
            {
              scope: { name: this.options.serviceName },
              metrics: [...byName.entries()].map(([name, states]) => ({
                name,
                sum: {
                  dataPoints: states.map((state) => ({
                    attributes: attributesOf(state.attributes),
                    startTimeUnixNano: this.startNano.toString(),
                    timeUnixNano: nowNano.toString(),
                    asInt: String(state.value),
                  })),
                  aggregationTemporality: CUMULATIVE,
                  isMonotonic: true,
                },
              })),
            },
          ],
        },
      ],
    };
  }

  private tracesPayload(spans: readonly FinishedSpan[]): unknown {
    return {
      resourceSpans: [
        {
          resource: this.resource(),
          scopeSpans: [
            {
              scope: { name: this.options.serviceName },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: span.name,
                kind: SPAN_KIND_SERVER,
                startTimeUnixNano: span.startNano.toString(),
                endTimeUnixNano: span.endNano.toString(),
                attributes: attributesOf(span.attributes),
                status:
                  span.error === undefined
                    ? { code: STATUS_UNSET }
                    : { code: STATUS_ERROR, message: span.error },
              })),
            },
          ],
        },
      ],
    };
  }

  private logsPayload(logs: readonly BufferedLog[]): unknown {
    return {
      resourceLogs: [
        {
          resource: this.resource(),
          scopeLogs: [
            {
              scope: { name: this.options.serviceName },
              logRecords: logs.map((log) => ({
                timeUnixNano: log.timeNano.toString(),
                severityNumber: SEVERITY_NUMBER[log.level],
                severityText: log.level.toUpperCase(),
                body: { stringValue: log.body },
                attributes: attributesOf(log.attributes),
                ...(log.traceId ? { traceId: log.traceId } : {}),
                ...(log.spanId ? { spanId: log.spanId } : {}),
              })),
            },
          ],
        },
      ],
    };
  }
}

/** Telemetria desligada: mesma interface, nenhum efeito. */
export class NoopTelemetry implements Telemetry {
  increment(_name: string, _attributes?: MetricAttributes, _value?: number): void {
    // Sem destino configurado, nao ha o que contar.
  }

  startSpan(_options: SpanOptions, parent?: TraceContext): Span {
    const context: TraceContext =
      parent === undefined
        ? startNewTrace()
        : { traceId: parent.traceId, spanId: newSpanId(), sampled: parent.sampled };

    // Ainda devolve um contexto valido: o trace_id continua indo para o log,
    // o que mantem as linhas de uma mesma requisicao correlacionadas mesmo sem
    // coletor no ambiente.
    return { context, end: () => undefined };
  }

  async flush(): Promise<void> {
    // Nada a entregar.
  }
}

function attributesOf(attributes: MetricAttributes): unknown[] {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ({ key, value: { stringValue: String(value) } }));
}

/** Chave estavel para um conjunto de etiquetas, independente da ordem. */
function stableKey(attributes: MetricAttributes): string {
  return Object.keys(attributes)
    .sort()
    .map((key) => `${key}=${attributes[key]}`)
    .join(',');
}

function toNano(millis: number): bigint {
  return BigInt(Math.round(millis)) * 1_000_000n;
}
