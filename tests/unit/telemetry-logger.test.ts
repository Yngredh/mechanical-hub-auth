import { describe, expect, it } from 'vitest';
import { TelemetryLogger, type LogRecorder } from '../../src/adapters/observability/telemetry-logger.js';
import { StructuredLogger } from '../../src/adapters/observability/structured-logger.js';

function build() {
  const lines: string[] = [];
  const recorded: Parameters<LogRecorder['record']>[0][] = [];

  const base = new StructuredLogger({
    level: 'debug',
    serviceName: 'mechanical-hub-auth',
    sink: (line) => lines.push(line),
  });

  const logger = new TelemetryLogger(base, { record: (log) => recorded.push(log) });

  return { logger, lines, recorded };
}

describe('TelemetryLogger', () => {
  /**
   * O stdout continua sendo escrito: o CloudWatch e a fonte que nao depende de
   * o coletor estar de pe. O caminho OTLP e adicional, nao substituto.
   */
  it('mantem a escrita em stdout', () => {
    const { logger, lines } = build();

    logger.info('login.success', { userId: 'u-1' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'info',
      event: 'login.success',
      userId: 'u-1',
    });
  });

  it('entrega o mesmo evento ao coletor', () => {
    const { logger, recorded } = build();

    logger.warn('login.failed', { reason: 'INVALID_CREDENTIALS' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.level).toBe('warn');
    expect(recorded[0]!.body).toBe('login.failed');
    expect(recorded[0]!.attributes).toMatchObject({ reason: 'INVALID_CREDENTIALS' });
  });

  /**
   * trace_id e span_id precisam sair dos atributos e virar campo do registro
   * OTLP: e por eles que o Grafana liga a linha de log ao span no Tempo.
   */
  it('promove trace_id e span_id a campos do registro', () => {
    const { logger, recorded } = build();

    logger
      .withContext({ trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' })
      .info('authorizer.allow');

    expect(recorded[0]!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(recorded[0]!.spanId).toBe('00f067aa0ba902b7');
  });

  it('nao inventa trace quando o contexto esta vazio', () => {
    const { logger, recorded } = build();

    logger.withContext({ trace_id: '', span_id: '' }).info('login.attempt');

    expect(recorded[0]!.traceId).toBeUndefined();
    expect(recorded[0]!.spanId).toBeUndefined();
  });

  it('acumula contexto ao derivar', () => {
    const { logger, recorded } = build();

    logger.withContext({ a: '1' }).withContext({ b: '2' }).info('evento');

    expect(recorded[0]!.attributes).toMatchObject({ a: '1', b: '2' });
  });

  it('serializa objeto aninhado em vez de virar [object Object]', () => {
    const { logger, recorded } = build();

    logger.info('evento', { detalhe: { causa: 'timeout' } });

    expect(recorded[0]!.attributes?.detalhe).toBe('{"causa":"timeout"}');
  });

  it('descarta campo nulo em vez de gravar a string "null"', () => {
    const { logger, recorded } = build();

    logger.info('evento', { vazio: null, ausente: undefined, presente: 'sim' });

    expect(recorded[0]!.attributes).toEqual({ presente: 'sim' });
  });

  it('respeita o nivel do logger de baixo', () => {
    const lines: string[] = [];
    const recorded: unknown[] = [];

    const base = new StructuredLogger({
      level: 'warn',
      serviceName: 'mechanical-hub-auth',
      sink: (line) => lines.push(line),
    });
    const logger = new TelemetryLogger(base, { record: (log) => recorded.push(log) });

    logger.debug('evento.silencioso');

    expect(lines).toHaveLength(0);
  });
});
