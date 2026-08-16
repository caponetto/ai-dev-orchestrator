import { describe, expect, it } from 'vitest';

import type { RunFailureContext } from '../failure-analyzer';
import { analyzeRunFailure } from '../failure-analyzer';

function makeContext(overrides: Partial<RunFailureContext> = {}): RunFailureContext {
  return {
    runId: 'run-1',
    finalState: 'CODING',
    completedAt: '2025-01-15T10:10:00Z',
    events: [],
    ...overrides,
  };
}

describe('analyzeRunFailure', () => {
  it('produces analysis with no error events', () => {
    const analysis = analyzeRunFailure(makeContext());
    expect(analysis.runId).toBe('run-1');
    expect(analysis.failedState).toBe('CODING');
    expect(analysis.rootCause).toContain('CODING');
    expect(analysis.errorChain).toHaveLength(0);
    expect(analysis.recommendation).toContain('workflow definition');
  });

  it('uses first error as root cause', () => {
    const analysis = analyzeRunFailure(
      makeContext({
        events: [
          {
            type: 'error',
            timestamp: '2025-01-15T10:05:00Z',
            source: 'runner-system',
            code: 'AGENT_ERROR',
            message: 'Agent runner unavailable',
          },
          {
            type: 'error',
            timestamp: '2025-01-15T10:06:00Z',
            source: 'runner-system',
            code: 'WORKER_FAILED',
            message: 'Worker failed',
          },
        ],
      }),
    );
    expect(analysis.rootCause).toBe('Agent runner unavailable');
    expect(analysis.errorChain).toHaveLength(2);
  });

  it('detects agent-related contributing factors', () => {
    const analysis = analyzeRunFailure(
      makeContext({
        events: [
          {
            type: 'error',
            timestamp: '2025-01-15T10:05:00Z',
            source: 'runner-system',
            code: 'AGENT_ERROR',
            message: 'Agent runner timeout',
          },
        ],
      }),
    );
    expect(analysis.contributingFactors.some((f) => f.includes('Agent'))).toBe(true);
    expect(analysis.recommendation).toContain('agent runner');
  });

  it('detects timeout contributing factors', () => {
    const analysis = analyzeRunFailure(
      makeContext({
        events: [
          {
            type: 'error',
            timestamp: '2025-01-15T10:05:00Z',
            source: 'workflow-engine',
            code: 'STATE_TIMEOUT',
            message: 'State timed out',
          },
        ],
      }),
    );
    expect(analysis.contributingFactors.some((f) => f.includes('Timeout'))).toBe(true);
  });

  it('detects multiple subsystems involved', () => {
    const analysis = analyzeRunFailure(
      makeContext({
        events: [
          {
            type: 'error',
            timestamp: '2025-01-15T10:05:00Z',
            source: 'runner-system',
            code: 'ERR',
            message: 'fail',
          },
          {
            type: 'error',
            timestamp: '2025-01-15T10:06:00Z',
            source: 'artifact-system',
            code: 'ERR',
            message: 'fail',
          },
        ],
      }),
    );
    expect(analysis.contributingFactors.some((f) => f.includes('Multiple subsystems'))).toBe(true);
  });

  it('recommends governance review for governance errors', () => {
    const analysis = analyzeRunFailure(
      makeContext({
        events: [
          {
            type: 'error',
            timestamp: '2025-01-15T10:05:00Z',
            source: 'governance',
            code: 'GOVERNANCE_DENIED',
            message: 'Denied',
          },
        ],
      }),
    );
    expect(analysis.recommendation).toContain('governance');
  });
});
