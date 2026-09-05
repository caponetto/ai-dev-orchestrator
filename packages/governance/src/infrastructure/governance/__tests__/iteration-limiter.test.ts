import type { IterationContractRegistry } from '@ai-dev-orchestrator/ports';
import { describe, expect, it, vi } from 'vitest';

import { PLAN_REVIEW_LOOP } from '../../iteration-contracts/built-in-contracts';
import { IterationLimiter } from '../iteration-limiter';

function makeRegistry(
  overrides: Partial<IterationContractRegistry> = {},
): IterationContractRegistry {
  const base = {
    getContract: vi.fn().mockReturnValue(null),
    listContracts: vi.fn().mockReturnValue([]),
    getContractForState: vi.fn().mockReturnValue(null),
    getIterationState: vi.fn(),
    recordStateEntry: vi.fn(),
    restoreIterationCounts: vi.fn(),
    restoreJudgeArbitrationCounts: vi.fn(),
    resetIterationCount: vi.fn(),
    ...overrides,
  };
  return base;
}

describe('IterationLimiter', () => {
  it('skips when no contract applies to state', () => {
    const limiter = new IterationLimiter(makeRegistry());
    const result = limiter.evaluate('INTAKE', 0);

    expect(result.result).toBe('skip');
    expect(result.evaluated).toBe(false);
  });

  it('passes when iteration count is below limit', () => {
    const limiter = new IterationLimiter(
      makeRegistry({
        getContractForState: vi.fn().mockReturnValue(PLAN_REVIEW_LOOP),
      }),
    );
    const result = limiter.evaluate('PLAN_REVIEW', 1);

    expect(result.result).toBe('pass');
    expect(result.evaluated).toBe(true);
  });

  it('fails when iteration count reaches limit', () => {
    const limiter = new IterationLimiter(
      makeRegistry({
        getContractForState: vi.fn().mockReturnValue(PLAN_REVIEW_LOOP),
      }),
    );
    const result = limiter.evaluate('PLAN_REVIEW', 5);

    expect(result.result).toBe('fail');
    expect(result.evaluated).toBe(true);
    expect(result.detail).toContain('exceeded');
  });

  it('fails when iteration count exceeds limit', () => {
    const limiter = new IterationLimiter(
      makeRegistry({
        getContractForState: vi.fn().mockReturnValue(PLAN_REVIEW_LOOP),
      }),
    );
    const result = limiter.evaluate('PLAN_REVIEW', 5);

    expect(result.result).toBe('fail');
  });
});
