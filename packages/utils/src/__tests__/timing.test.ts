import { describe, expect, it } from 'vitest';

import { raceWithTimeout, sleep } from '../timing';

describe('sleep', () => {
  it('resolves after the specified duration', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('handles zero duration', async () => {
    await sleep(0);
  });

  it('handles negative duration', async () => {
    await sleep(-10);
  });
});

describe('raceWithTimeout', () => {
  it('returns the promise result when it resolves before timeout', async () => {
    const result = await raceWithTimeout(Promise.resolve('done'), 1000);
    expect(result).toBe('done');
  });

  it('returns null when the promise times out', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve('late');
      }, 500);
    });
    const result = await raceWithTimeout(slow, 10);
    expect(result).toBeNull();
  });
});
