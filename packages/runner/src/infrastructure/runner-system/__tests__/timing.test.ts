import { describe, expect, it } from 'vitest';

import { raceWithTimeout, sleep } from '../timing';

describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('handles zero ms', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('clamps negative ms to zero', async () => {
    await expect(sleep(-100)).resolves.toBeUndefined();
  });
});

describe('raceWithTimeout', () => {
  it('returns the promise value when it resolves before timeout', async () => {
    const result = await raceWithTimeout(Promise.resolve('fast'), 1000);
    expect(result).toBe('fast');
  });

  it('returns null when the timeout fires first', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('slow');
      }, 500);
    });
    const result = await raceWithTimeout(slow, 10);
    expect(result).toBeNull();
  });

  it('propagates rejections from the promise', async () => {
    const failing = Promise.reject(new Error('boom'));
    await expect(raceWithTimeout(failing, 1000)).rejects.toThrow('boom');
  });

  it('cleans up the timer when the promise wins', async () => {
    const result = await raceWithTimeout(Promise.resolve(42), 60_000);
    expect(result).toBe(42);
  });
});
