/**
 * Log estruturado. O core emite eventos nomeados; o adaptador decide o
 * formato e o destino (stdout JSON, agente do Datadog, etc).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Deriva um logger que carrega campos fixos (correlacao de requisicao). */
  withContext(fields: LogFields): Logger;
}
