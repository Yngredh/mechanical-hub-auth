import { describe, expect, it } from 'vitest';
import { CachedSecretProvider } from '../../src/adapters/secrets/cached-secret-provider.js';
import { EnvironmentSecretProvider } from '../../src/adapters/secrets/environment-secret-provider.js';
import type { Clock } from '../../src/core/ports/clock.js';
import type { SecretProvider } from '../../src/core/ports/secret-provider.js';

describe('EnvironmentSecretProvider', () => {
  it('le o valor da variavel indicada', async () => {
    const provider = new EnvironmentSecretProvider({ TOKEN_SIGNING_KEY: 'chave' });

    expect(await provider.getSecret('TOKEN_SIGNING_KEY')).toBe('chave');
  });

  it('falha alto quando o segredo nao esta configurado', async () => {
    const provider = new EnvironmentSecretProvider({});

    await expect(provider.getSecret('TOKEN_SIGNING_KEY')).rejects.toThrow(/ausente/i);
  });

  it('trata variavel vazia como ausente', async () => {
    const provider = new EnvironmentSecretProvider({ TOKEN_SIGNING_KEY: '' });

    await expect(provider.getSecret('TOKEN_SIGNING_KEY')).rejects.toThrow(/ausente/i);
  });

  it('desserializa segredo estruturado', async () => {
    const provider = new EnvironmentSecretProvider({
      DB: JSON.stringify({ username: 'lambda_auth', password: 's3nh4' }),
    });

    expect(await provider.getSecretAsJson('DB')).toEqual({
      username: 'lambda_auth',
      password: 's3nh4',
    });
  });

  it('reporta JSON invalido de forma explicita', async () => {
    const provider = new EnvironmentSecretProvider({ DB: 'nao-e-json' });

    await expect(provider.getSecretAsJson('DB')).rejects.toThrow(/JSON valido/);
  });
});

function countingProvider(): SecretProvider & { calls: number } {
  return {
    calls: 0,
    async getSecret(reference: string) {
      this.calls += 1;
      return `${reference}-v${this.calls}`;
    },
    async getSecretAsJson<T>() {
      return {} as T;
    },
  };
}

function fixedClock(): Clock & { advance(ms: number): void } {
  let current = 0;
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('CachedSecretProvider', () => {
  it('resolve uma unica vez dentro do TTL', async () => {
    const delegate = countingProvider();
    const cached = new CachedSecretProvider(delegate, 900, fixedClock());

    await cached.getSecret('KEY');
    await cached.getSecret('KEY');

    expect(delegate.calls).toBe(1);
  });

  it('busca de novo depois que o TTL expira', async () => {
    const delegate = countingProvider();
    const clock = fixedClock();
    const cached = new CachedSecretProvider(delegate, 10, clock);

    expect(await cached.getSecret('KEY')).toBe('KEY-v1');
    clock.advance(10_001);
    expect(await cached.getSecret('KEY')).toBe('KEY-v2');
  });

  it('mantem entradas separadas por referencia', async () => {
    const delegate = countingProvider();
    const cached = new CachedSecretProvider(delegate, 900, fixedClock());

    await cached.getSecret('A');
    await cached.getSecret('B');

    expect(delegate.calls).toBe(2);
  });

  it('invalidate forca nova resolucao', async () => {
    const delegate = countingProvider();
    const cached = new CachedSecretProvider(delegate, 900, fixedClock());

    await cached.getSecret('KEY');
    cached.invalidate('KEY');
    await cached.getSecret('KEY');

    expect(delegate.calls).toBe(2);
  });

  it('invalidate sem argumento limpa tudo', async () => {
    const delegate = countingProvider();
    const cached = new CachedSecretProvider(delegate, 900, fixedClock());

    await cached.getSecret('A');
    await cached.getSecret('B');
    cached.invalidate();
    await cached.getSecret('A');

    expect(delegate.calls).toBe(3);
  });
});
