import { describe, expect, it } from 'vitest';
import { InMemoryAttemptLimiter } from '../../src/adapters/ratelimit/in-memory-attempt-limiter.js';
import type { Clock } from '../../src/core/ports/clock.js';

function fixedClock(start = 0): Clock & { advance(ms: number): void } {
  let current = start;

  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const KEY = '52998224725';

describe('InMemoryAttemptLimiter', () => {
  it('nao bloqueia antes de atingir o limite', async () => {
    const limiter = new InMemoryAttemptLimiter({ maxFailures: 3, windowSeconds: 900 });

    await limiter.registerFailure(KEY);
    await limiter.registerFailure(KEY);

    expect(await limiter.isBlocked(KEY)).toBe(false);
  });

  it('bloqueia ao atingir o limite', async () => {
    const limiter = new InMemoryAttemptLimiter({ maxFailures: 3, windowSeconds: 900 });

    for (let i = 0; i < 3; i += 1) await limiter.registerFailure(KEY);

    expect(await limiter.isBlocked(KEY)).toBe(true);
  });

  it('libera quando a janela expira', async () => {
    const clock = fixedClock();
    const limiter = new InMemoryAttemptLimiter({ maxFailures: 2, windowSeconds: 10, clock });

    await limiter.registerFailure(KEY);
    await limiter.registerFailure(KEY);
    expect(await limiter.isBlocked(KEY)).toBe(true);

    clock.advance(10_001);
    expect(await limiter.isBlocked(KEY)).toBe(false);
  });

  it('reset limpa o contador', async () => {
    const limiter = new InMemoryAttemptLimiter({ maxFailures: 1, windowSeconds: 900 });

    await limiter.registerFailure(KEY);
    await limiter.reset(KEY);

    expect(await limiter.isBlocked(KEY)).toBe(false);
  });

  it('isola chaves diferentes', async () => {
    const limiter = new InMemoryAttemptLimiter({ maxFailures: 1, windowSeconds: 900 });

    await limiter.registerFailure(KEY);

    expect(await limiter.isBlocked(KEY)).toBe(true);
    expect(await limiter.isBlocked('11144477735')).toBe(false);
  });
});
