import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../../hooks/use-agent-stream';
import { buildStateDispatchMap } from '../parallel-phases';

function doneLine(status: 'success' | 'failure'): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'REVIEW',
    roleId: 'reviewer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'stdout',
    content: `Task completed (${status}).`,
    structuredData: { phase: 'done', sender: 'agent', status },
  };
}

describe('buildStateDispatchMap', () => {
  it('marks a dispatch as error when the done event reports failure', () => {
    const dispatch = buildStateDispatchMap([doneLine('failure')])
      .get('REVIEW')
      ?.get('dispatch-1');
    expect(dispatch?.status).toBe('error');
  });

  it('marks a dispatch as done when the done event reports success', () => {
    const dispatch = buildStateDispatchMap([doneLine('success')])
      .get('REVIEW')
      ?.get('dispatch-1');
    expect(dispatch?.status).toBe('done');
  });
});
