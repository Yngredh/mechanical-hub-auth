import type { LogFields, LogLevel, Logger } from '../../core/ports/logger.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface StructuredLoggerOptions {
  readonly level: LogLevel;
  readonly serviceName: string;
  readonly baseFields?: LogFields;
  /** Injetavel para teste; por padrao escreve em stdout. */
  readonly sink?: (line: string) => void;
}

/**
 * Uma linha JSON por evento -- formato exigido pela observabilidade da Fase 3.
 * Sem dependencia de biblioteca de log: menos peso no bundle, menos cold start.
 */
export class StructuredLogger implements Logger {
  private readonly level: LogLevel;
  private readonly serviceName: string;
  private readonly baseFields: LogFields;
  private readonly sink: (line: string) => void;

  constructor(options: StructuredLoggerOptions) {
    this.level = options.level;
    this.serviceName = options.serviceName;
    this.baseFields = options.baseFields ?? {};
    this.sink = options.sink ?? ((line) => process.stdout.write(`${line}\n`));
  }

  debug(event: string, fields?: LogFields): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write('error', event, fields);
  }

  withContext(fields: LogFields): Logger {
    return new StructuredLogger({
      level: this.level,
      serviceName: this.serviceName,
      baseFields: { ...this.baseFields, ...fields },
      sink: this.sink,
    });
  }

  private write(level: LogLevel, event: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.serviceName,
        event,
        ...this.baseFields,
        ...fields,
      }),
    );
  }
}
