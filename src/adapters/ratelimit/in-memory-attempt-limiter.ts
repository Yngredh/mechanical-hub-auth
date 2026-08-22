import type { AttemptLimiter } from '../../core/ports/attempt-limiter.js';
import type { Clock } from '../../core/ports/clock.js';
import { SYSTEM_CLOCK } from '../../core/ports/clock.js';

export interface InMemoryAttemptLimiterOptions {
  readonly maxFailures: number;
  readonly windowSeconds: number;
  readonly clock?: Clock;
}

/**
 * Contador de falhas por instancia de execucao.
 *
 * Limitacao assumida: o estado vive na memoria da instancia, entao o limite e
 * por instancia, nao global. Isso e suficiente para conter tentativa manual e
 * para o ambiente de lab, e some junto com a instancia. Para um limite real
 * distribuido, trocar por um adaptador com armazenamento compartilhado -- a
 * porta AttemptLimiter nao muda.
 *
 * A defesa de verdade contra volume fica no throttling do proprio gateway.
 */
export class InMemoryAttemptLimiter implements AttemptLimiter {
  private readonly failures = new Map<string, { count: number; expiresAt: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly clock: Clock;

  constructor(options: InMemoryAttemptLimiterOptions) {
    this.maxFailures = options.maxFailures;
    this.windowMs = options.windowSeconds * 1000;
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  async isBlocked(key: string): Promise<boolean> {
    const entry = this.current(key);
    return entry !== null && entry.count >= this.maxFailures;
  }

  async registerFailure(key: string): Promise<void> {
    const now = this.clock.now().getTime();
    const entry = this.current(key);

    if (entry === null) {
      this.failures.set(key, { count: 1, expiresAt: now + this.windowMs });
      return;
    }

    entry.count += 1;
  }

  async reset(key: string): Promise<void> {
    this.failures.delete(key);
  }

  private current(key: string): { count: number; expiresAt: number } | null {
    const entry = this.failures.get(key);
    if (entry === undefined) return null;

    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.failures.delete(key);
      return null;
    }

    return entry;
  }
}
