import { describe, expect, it, vi } from 'vitest';
import { NoopTelemetry, OtlpTelemetry } from '../../src/adapters/observability/otlp-telemetry.js';

interface CapturedRequest {
  readonly url: string;
  readonly body: any;
}

function build(options: { failWith?: Error; status?: number } = {}) {
  const requests: CapturedRequest[] = [];
  const errors: string[] = [];
  let clock = 1_700_000_000_000;

  const fetchImpl = vi.fn(async (url: any, init: any) => {
    if (options.failWith) throw options.failWith;

    requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return { ok: (options.status ?? 200) < 400, status: options.status ?? 200 } as Response;
  });

  const telemetry = new OtlpTelemetry({
    endpoint: 'http://collector:4318',
    serviceName: 'mechanical-hub-auth',
    environment: 'production',
    instanceId: 'instancia-1',
    timeoutMs: 500,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onError: (message) => errors.push(message),
    now: () => clock,
  });

  return {
    telemetry,
    requests,
    errors,
    fetchImpl,
    advance: (ms: number) => {
      clock += ms;
    },
    payloadFor: (signal: string) => requests.find((r) => r.url.endsWith(signal))?.body,
  };
}

describe('OtlpTelemetry — metricas', () => {
  it('nao envia nada quando nao ha o que enviar', async () => {
    const { telemetry, fetchImpl } = build();

    await telemetry.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('publica contador cumulativo e monotonico', async () => {
    const { telemetry, payloadFor } = build();

    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });
    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });
    await telemetry.flush();

    const sum = payloadFor('/v1/metrics').resourceMetrics[0].scopeMetrics[0].metrics[0].sum;

    expect(sum.isMonotonic).toBe(true);
    // AGGREGATION_TEMPORALITY_CUMULATIVE. Delta seria descartado pelo
    // exportador prometheusremotewrite do coletor, em silencio.
    expect(sum.aggregationTemporality).toBe(2);
    expect(sum.dataPoints[0].asInt).toBe('2');
  });

  it('separa etiquetas diferentes em pontos diferentes da mesma metrica', async () => {
    const { telemetry, payloadFor } = build();

    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });
    telemetry.increment('mechanical_hub_auth_login', { result: 'failed' });
    telemetry.increment('mechanical_hub_auth_login', { result: 'failed' });
    await telemetry.flush();

    const metrics = payloadFor('/v1/metrics').resourceMetrics[0].scopeMetrics[0].metrics;

    expect(metrics).toHaveLength(1);
    expect(metrics[0].sum.dataPoints).toHaveLength(2);

    const porResultado = Object.fromEntries(
      metrics[0].sum.dataPoints.map((p: any) => [p.attributes[0].value.stringValue, p.asInt]),
    );
    expect(porResultado).toEqual({ success: '1', failed: '2' });
  });

  /**
   * O acumulado precisa continuar subindo entre invocacoes: e o que o
   * Prometheus espera de um contador. Zerar depois do flush faria a serie andar
   * para tras e o rate() enxergaria um reset a cada requisicao.
   */
  it('mantem o acumulado entre flushes', async () => {
    const { telemetry, requests } = build();

    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });
    await telemetry.flush();
    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });
    await telemetry.flush();

    const pontos = requests
      .filter((r) => r.url.endsWith('/v1/metrics'))
      .map((r) => r.body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asInt);

    expect(pontos).toEqual(['1', '2']);
  });

  it('identifica a instancia de execucao no recurso', async () => {
    const { telemetry, payloadFor } = build();

    telemetry.increment('x');
    await telemetry.flush();

    const atributos = Object.fromEntries(
      payloadFor('/v1/metrics').resourceMetrics[0].resource.attributes.map((a: any) => [
        a.key,
        a.value.stringValue,
      ]),
    );

    // Sem service.instance.id, duas instancias concorrentes publicariam a mesma
    // serie cumulativa e uma sobrescreveria a outra.
    expect(atributos['service.instance.id']).toBe('instancia-1');
    expect(atributos['service.name']).toBe('mechanical-hub-auth');
  });
});

describe('OtlpTelemetry — rastros', () => {
  it('mede o span e o envia com identificadores validos', async () => {
    const { telemetry, advance, payloadFor } = build();

    const span = telemetry.startSpan({ name: 'POST /auth/login' });
    advance(42);
    span.end({ attributes: { 'http.status_code': '200' } });
    await telemetry.flush();

    const enviado = payloadFor('/v1/traces').resourceSpans[0].scopeSpans[0].spans[0];

    expect(enviado.name).toBe('POST /auth/login');
    expect(enviado.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(enviado.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(BigInt(enviado.endTimeUnixNano) - BigInt(enviado.startTimeUnixNano)).toBe(42_000_000n);
    expect(enviado.status.code).toBe(0);
  });

  it('continua o rastro do chamador quando ha pai', async () => {
    const { telemetry, payloadFor } = build();

    const parent = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    };

    const span = telemetry.startSpan({ name: 'authorizer' }, parent);
    span.end();
    await telemetry.flush();

    const enviado = payloadFor('/v1/traces').resourceSpans[0].scopeSpans[0].spans[0];

    expect(enviado.traceId).toBe(parent.traceId);
    expect(enviado.parentSpanId).toBe(parent.spanId);
    // Span novo dentro do mesmo rastro: nao pode reaproveitar o id do pai.
    expect(enviado.spanId).not.toBe(parent.spanId);
  });

  it('marca o span como falho quando ha erro', async () => {
    const { telemetry, payloadFor } = build();

    telemetry.startSpan({ name: 'authorizer' }).end({ error: 'chave indisponivel' });
    await telemetry.flush();

    const enviado = payloadFor('/v1/traces').resourceSpans[0].scopeSpans[0].spans[0];

    expect(enviado.status).toEqual({ code: 2, message: 'chave indisponivel' });
  });

  it('nao reenvia spans ja entregues', async () => {
    const { telemetry, requests } = build();

    telemetry.startSpan({ name: 'a' }).end();
    await telemetry.flush();
    await telemetry.flush();

    expect(requests.filter((r) => r.url.endsWith('/v1/traces'))).toHaveLength(1);
  });
});

describe('OtlpTelemetry — logs', () => {
  it('envia o registro com trace e span como campo de primeira classe', async () => {
    const { telemetry, payloadFor } = build();

    telemetry.record({
      level: 'warn',
      body: 'login.failed',
      attributes: { reason: 'INVALID_CREDENTIALS' },
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
    await telemetry.flush();

    const registro = payloadFor('/v1/logs').resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(registro.body.stringValue).toBe('login.failed');
    expect(registro.severityText).toBe('WARN');
    expect(registro.severityNumber).toBe(13);
    expect(registro.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(registro.spanId).toBe('00f067aa0ba902b7');
  });
});

describe('OtlpTelemetry — resiliencia', () => {
  /**
   * A garantia que mais importa: a requisicao do usuario ja foi atendida quando
   * o flush acontece. Coletor fora do ar nao pode transformar um login bem
   * sucedido em erro.
   */
  it('nao propaga falha de rede', async () => {
    const { telemetry, errors } = build({ failWith: new Error('ECONNREFUSED') });

    telemetry.increment('mechanical_hub_auth_login', { result: 'success' });

    await expect(telemetry.flush()).resolves.toBeUndefined();
    expect(errors[0]).toContain('ECONNREFUSED');
  });

  it('nao propaga resposta de erro do coletor', async () => {
    const { telemetry, errors } = build({ status: 503 });

    telemetry.increment('x');

    await expect(telemetry.flush()).resolves.toBeUndefined();
    expect(errors[0]).toContain('503');
  });

  it('limita o tempo de espera do envio', async () => {
    const { telemetry, fetchImpl } = build();

    telemetry.increment('x');
    await telemetry.flush();

    // Sem prazo, um coletor lento seguraria a resposta ate o timeout da propria
    // funcao.
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('NoopTelemetry', () => {
  it('nao falha e nao exporta nada', async () => {
    const telemetry = new NoopTelemetry();

    telemetry.increment('x', { a: 'b' });
    telemetry.startSpan({ name: 'y' }).end({ error: 'z' });

    await expect(telemetry.flush()).resolves.toBeUndefined();
  });

  /**
   * Mesmo sem coletor o contexto precisa ser valido: o trace_id continua indo
   * para o log, mantendo as linhas de uma mesma requisicao correlacionadas.
   */
  it('ainda devolve um contexto de rastro utilizavel', () => {
    const context = new NoopTelemetry().startSpan({ name: 'y' }).context;

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});
