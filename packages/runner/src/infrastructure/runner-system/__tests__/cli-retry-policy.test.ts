import { describe, expect, it } from 'vitest';

import { computeRetryDelayMs } from '../cli-retry-policy';

describe('computeRetryDelayMs', () => {
  it('grows exponentially without jitter', () => {
    expect(computeRetryDelayMs(1, 2000, () => 0)).toBe(2000);
    expect(computeRetryDelayMs(2, 2000, () => 0)).toBe(5000);
  });

  it('adds up to half the base delay as jitter', () => {
    expect(computeRetryDelayMs(1, 2000, () => 0.999)).toBeLessThanOrEqual(3000);
    expect(computeRetryDelayMs(1, 2000, () => 0.5)).toBe(2500);
  });
});
