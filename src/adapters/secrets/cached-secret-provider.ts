import type { SecretProvider } from '../../core/ports/secret-provider.js';
import type { Clock } from '../../core/ports/clock.js';
import { SYSTEM_CLOCK } from '../../core/ports/clock.js';

/**
 * Cache com TTL na frente de qualquer SecretProvider.
 *
 * Instancias de funcao serverless sao reaproveitadas entre invocacoes; sem
 * cache, toda chamada quente pagaria uma ida ao cofre. O TTL limita a janela
 * em que um segredo rotacionado ainda circula com o valor antigo.
 */
export class CachedSecretProvider implements SecretProvider {
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly delegate: SecretProvider,
    private readonly ttlSeconds: number,
    private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  async getSecret(reference: string): Promise<string> {
    const now = this.clock.now().getTime();
    const cached = this.cache.get(reference);

    if (cached !== undefined && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await this.delegate.getSecret(reference);
    this.cache.set(reference, { value, expiresAt: now + this.ttlSeconds * 1000 });

    return value;
  }

  async getSecretAsJson<T>(reference: string): Promise<T> {
    const raw = await this.getSecret(reference);

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Segredo ${reference} nao contem JSON valido`);
    }
  }

  invalidate(reference?: string): void {
    if (reference === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(reference);
  }
}
