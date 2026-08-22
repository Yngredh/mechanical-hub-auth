import { describe, expect, it } from 'vitest';
import { StructuredLogger } from '../../src/adapters/observability/structured-logger.js';

function collect(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
  const lines: string[] = [];
  const logger = new StructuredLogger({
    level,
    serviceName: 'mechanical-hub-auth',
    sink: (line) => lines.push(line),
  });

  return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
}

describe('StructuredLogger', () => {
  it('emite uma linha JSON por evento', () => {
    const { logger, parsed } = collect();

    logger.info('login.success', { userId: 'abc' });

    expect(parsed()).toEqual([
      expect.objectContaining({
        level: 'info',
        service: 'mechanical-hub-auth',
        event: 'login.success',
        userId: 'abc',
        timestamp: expect.any(String),
      }),
    ]);
  });

  it('respeita o nivel configurado', () => {
    const { logger, lines } = collect('warn');

    logger.debug('ignorado');
    logger.info('ignorado');
    logger.warn('registrado');

    expect(lines).toHaveLength(1);
  });

  it('propaga o contexto para os eventos derivados', () => {
    const { logger, parsed } = collect();

    logger.withContext({ traceId: 'trace-1' }).warn('login.failed', { reason: 'INVALID_CREDENTIALS' });

    expect(parsed()[0]).toMatchObject({ traceId: 'trace-1', reason: 'INVALID_CREDENTIALS' });
  });

  it('acumula contextos encadeados', () => {
    const { logger, parsed } = collect();

    logger
      .withContext({ traceId: 'trace-1' })
      .withContext({ cpfMasked: '***.***.247-25' })
      .info('login.attempt');

    expect(parsed()[0]).toMatchObject({ traceId: 'trace-1', cpfMasked: '***.***.247-25' });
  });
});
