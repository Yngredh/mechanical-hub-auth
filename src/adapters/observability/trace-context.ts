import { randomBytes } from 'node:crypto';
import type { TraceContext } from '../../core/ports/telemetry.js';

/**
 * Contexto de rastro no formato W3C Trace Context.
 *
 * Implementado a mao, e nao com @opentelemetry/api, pelo mesmo motivo que o
 * logger deste repositorio nao usa biblioteca de log: o pacote inteiro entraria
 * no bundle da funcao para gerar dois numeros aleatorios e ler um cabecalho. No
 * caminho do login, cada dependencia a mais e cold start a mais.
 *
 * Formato do cabecalho: `version-traceId-spanId-flags`
 *   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Le o `traceparent` de entrada.
 *
 * Devolve `null` quando o cabecalho esta ausente ou malformado — nesse caso o
 * chamador inicia um rastro novo em vez de propagar lixo. Ids zerados sao
 * recusados: o proprio padrao os define como invalidos.
 */
export function parseTraceParent(header: string | null | undefined): TraceContext | null {
  if (typeof header !== 'string') return null;

  const match = TRACEPARENT_PATTERN.exec(header.trim().toLowerCase());
  if (match === null) return null;

  const traceId = match[1];
  const spanId = match[2];
  const flags = match[3];

  // A expressao regular garante os tres grupos, mas o compilador nao sabe
  // disso com noUncheckedIndexedAccess ligado — e a checagem custa nada.
  if (traceId === undefined || spanId === undefined || flags === undefined) return null;

  if (traceId === INVALID_TRACE_ID || spanId === INVALID_SPAN_ID) return null;

  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 0x01) === 0x01,
  };
}

/** Monta o cabecalho para propagar adiante. */
export function formatTraceParent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

/**
 * Contexto de um rastro que comeca aqui.
 *
 * `sampled` e sempre verdadeiro: o volume deste projeto e baixo e a
 * demonstracao precisa que a requisicao feita na hora apareca no Tempo. Se um
 * dia houver volume que justifique amostragem, e aqui que ela entra.
 */
export function startNewTrace(): TraceContext {
  return { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
}
