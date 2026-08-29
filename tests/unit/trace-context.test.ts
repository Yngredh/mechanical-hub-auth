import { describe, expect, it } from 'vitest';
import {
  formatTraceParent,
  newSpanId,
  newTraceId,
  parseTraceParent,
  startNewTrace,
} from '../../src/adapters/observability/trace-context.js';

describe('trace-context — geracao de identificadores', () => {
  it('gera traceId de 32 hex e spanId de 16 hex', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('nao repete identificadores', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newTraceId()));
    expect(ids.size).toBe(500);
  });

  it('comeca o rastro marcado como amostrado', () => {
    expect(startNewTrace().sampled).toBe(true);
  });
});

describe('trace-context — leitura do cabecalho traceparent', () => {
  it('le um cabecalho valido', () => {
    const parsed = parseTraceParent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

    expect(parsed).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });
  });

  it('aceita maiuscula e espaco em volta', () => {
    const parsed = parseTraceParent('  00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-00  ');

    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.sampled).toBe(false);
  });

  /**
   * Cabecalho ruim precisa virar `null` para que o chamador comece um rastro
   * novo. Propagar um id malformado produziria um trace que o Tempo nao
   * consegue montar — pior do que nao ter rastro.
   */
  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vazio', ''],
    ['versao desconhecida', '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['traceId curto', '00-4bf92f35-00f067aa0ba902b7-01'],
    ['spanId curto', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067-01'],
    ['caractere invalido', '00-zzzz2f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['sem separadores', '004bf92f3577b34da6a3ce929d0e0e473600f067aa0ba902b701'],
  ])('%s devolve null', (_label, header) => {
    expect(parseTraceParent(header as string | null | undefined)).toBeNull();
  });

  /** O proprio padrao W3C define ids zerados como invalidos. */
  it('recusa traceId zerado', () => {
    expect(parseTraceParent(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).toBeNull();
  });

  it('recusa spanId zerado', () => {
    expect(parseTraceParent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`)).toBeNull();
  });
});

describe('trace-context — ida e volta', () => {
  it('formata e le de volta o mesmo contexto', () => {
    const original = startNewTrace();

    expect(parseTraceParent(formatTraceParent(original))).toEqual(original);
  });
});
