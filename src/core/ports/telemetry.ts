/**
 * Telemetria: metricas e rastros.
 *
 * O core so conhece esta interface. Quem decide o protocolo e o destino e o
 * adaptador — hoje OTLP sobre HTTP para o coletor OpenTelemetry, amanha
 * qualquer outra coisa, sem tocar em caso de uso.
 *
 * Todos os metodos sao deliberadamente sincronos e nao lancam. Observabilidade
 * que derruba o login e pior do que observabilidade nenhuma: o unico ponto
 * assincrono e o flush, e ele engole a propria falha.
 */

export type MetricAttributes = Readonly<Record<string, string>>;

/** Contexto de rastro no formato W3C, propagado pelo cabecalho `traceparent`. */
export interface TraceContext {
  /** 32 caracteres hexadecimais. */
  readonly traceId: string;
  /** 16 caracteres hexadecimais. */
  readonly spanId: string;
  /** Rastro herdado do chamador, em vez de iniciado aqui. */
  readonly sampled: boolean;
}

export interface SpanOptions {
  readonly name: string;
  readonly attributes?: MetricAttributes;
}

export interface Span {
  readonly context: TraceContext;
  /** Encerra o rastro. `error` marca o span como falho no Tempo. */
  end(outcome?: { readonly error?: string; readonly attributes?: MetricAttributes }): void;
}

export interface Telemetry {
  /** Incrementa um contador monotonico. */
  increment(name: string, attributes?: MetricAttributes, value?: number): void;

  /** Abre um span. O `parent` vem do cabecalho traceparent, quando houver. */
  startSpan(options: SpanOptions, parent?: TraceContext): Span;

  /**
   * Entrega o que estiver acumulado.
   *
   * Precisa ser chamado antes do handler retornar: a Lambda congela a execucao
   * assim que a resposta sai, e qualquer envio pendente so seria retomado na
   * proxima invocacao — ou nunca, se a instancia for reciclada.
   *
   * Nunca lanca. Falha de telemetria vira log e nada mais.
   */
  flush(): Promise<void>;
}
