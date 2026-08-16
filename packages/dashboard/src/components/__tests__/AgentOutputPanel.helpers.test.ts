import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import {
  buildStateDispatchMap,
  flushGroup,
  groupDispatchesIntoParallelRounds,
  markInactiveAsDone,
  type MutableDispatch,
  populateDispatchStartTimes,
  resolveTerminalStatuses,
} from '../output';

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'state-1',
    roleId: 'reviewer',
    dispatchId: 'dispatch-1',
    timestamp: '2024-01-01T00:00:00Z',
    type: 'stdout',
    content: '',
    ...overrides,
  };
}

describe('flushGroup', () => {
  it('returns undefined when current is null', () => {
    expect(flushGroup(null)).toBeUndefined();
  });

  it('returns a MessageGroup from a valid accumulator', () => {
    const lines = [makeLine()];
    const result = flushGroup({
      sender: 'agent',
      label: 'Reviewer',
      stateId: 'state-1',
      lines,
    });
    expect(result).toEqual({
      sender: 'agent',
      senderLabel: 'Reviewer',
      stateId: 'state-1',
      lines,
    });
  });

  it('handles undefined stateId', () => {
    const lines = [makeLine()];
    const result = flushGroup({
      sender: 'orchestrator',
      label: 'AI Dev Orchestrator',
      stateId: undefined,
      lines,
    });
    expect(result).toEqual({
      sender: 'orchestrator',
      senderLabel: 'AI Dev Orchestrator',
      stateId: undefined,
      lines,
    });
  });
});

describe('buildStateDispatchMap', () => {
  it('returns empty map for empty input', () => {
    const result = buildStateDispatchMap([]);
    expect(result.size).toBe(0);
  });

  it('skips lines without stateId or dispatchId', () => {
    const result = buildStateDispatchMap([
      makeLine({ stateId: '', dispatchId: 'dispatch-1' }),
      makeLine({ stateId: 'state-1', dispatchId: '' }),
    ]);
    expect(result.size).toBe(0);
  });

  it('skips orchestrator and human lines', () => {
    const result = buildStateDispatchMap([
      makeLine({ roleId: 'orchestrator' }),
      makeLine({
        roleId: 'human',
        protocolMessage: { messageType: 'permission_response', payload: { granted: true } },
      }),
    ]);
    expect(result.size).toBe(0);
  });

  it('groups lines by state and dispatch', () => {
    const lines = [
      makeLine({ stateId: 'state-1', dispatchId: 'd-1', roleId: 'reviewer' }),
      makeLine({ stateId: 'state-1', dispatchId: 'd-1', roleId: 'reviewer' }),
      makeLine({ stateId: 'state-1', dispatchId: 'd-2', roleId: 'coder' }),
    ];
    const result = buildStateDispatchMap(lines);
    expect(result.size).toBe(1);
    const stateDispatches = result.get('state-1');
    expect(stateDispatches?.size).toBe(2);
    expect(stateDispatches?.get('d-1')?.lines).toHaveLength(2);
    expect(stateDispatches?.get('d-2')?.lines).toHaveLength(1);
  });

  it('marks dispatch as done when done message found', () => {
    const lines = [
      makeLine({ stateId: 'state-1', dispatchId: 'd-1', roleId: 'reviewer' }),
      makeLine({
        stateId: 'state-1',
        dispatchId: 'd-1',
        roleId: 'reviewer',
        protocolMessage: { messageType: 'done', payload: { summary: 'All good' } },
      }),
    ];
    const result = buildStateDispatchMap(lines);
    const dispatch = result.get('state-1')?.get('d-1');
    expect(dispatch?.status).toBe('done');
    expect(dispatch?.summary).toBe('All good');
  });

  it('marks dispatch as error when error message found', () => {
    const lines = [
      makeLine({
        stateId: 'state-1',
        dispatchId: 'd-1',
        roleId: 'reviewer',
        protocolMessage: { messageType: 'error', payload: { message: 'Failed' } },
      }),
    ];
    const result = buildStateDispatchMap(lines);
    const dispatch = result.get('state-1')?.get('d-1');
    expect(dispatch?.status).toBe('error');
    expect(dispatch?.summary).toBe('Failed');
  });
});

describe('resolveTerminalStatuses', () => {
  it('resolves working dispatches from allLines', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1' })],
      status: 'working',
    });
    byState.set('state-1', stateDispatches);

    const allLines = [
      makeLine({
        dispatchId: 'd-1',
        protocolMessage: { messageType: 'done', payload: { summary: 'Resolved' } },
      }),
    ];

    resolveTerminalStatuses(byState, allLines);
    expect(stateDispatches.get('d-1')?.status).toBe('done');
    expect(stateDispatches.get('d-1')?.summary).toBe('Resolved');
  });

  it('resolves error status from allLines', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1' })],
      status: 'working',
    });
    byState.set('state-1', stateDispatches);

    const allLines = [
      makeLine({
        dispatchId: 'd-1',
        protocolMessage: { messageType: 'error', payload: { message: 'Crash' } },
      }),
    ];

    resolveTerminalStatuses(byState, allLines);
    expect(stateDispatches.get('d-1')?.status).toBe('error');
    expect(stateDispatches.get('d-1')?.summary).toBe('Crash');
  });

  it('does not modify already-done dispatches', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1' })],
      status: 'done',
      summary: 'Original',
    });
    byState.set('state-1', stateDispatches);

    const allLines = [
      makeLine({
        dispatchId: 'd-1',
        protocolMessage: { messageType: 'done', payload: { summary: 'Overwrite' } },
      }),
    ];

    resolveTerminalStatuses(byState, allLines);
    expect(stateDispatches.get('d-1')?.summary).toBe('Original');
  });

  it('resolves via structuredData phase=done', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1' })],
      status: 'working',
    });
    byState.set('state-1', stateDispatches);

    const allLines = [
      makeLine({
        dispatchId: 'd-1',
        structuredData: { phase: 'done', summary: 'Phase done' },
      }),
    ];

    resolveTerminalStatuses(byState, allLines);
    expect(stateDispatches.get('d-1')?.status).toBe('done');
    expect(stateDispatches.get('d-1')?.summary).toBe('Phase done');
  });
});

describe('markInactiveAsDone', () => {
  it('marks working dispatches as done when run is inactive', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [],
      status: 'working',
    });
    byState.set('state-1', stateDispatches);

    markInactiveAsDone(byState, false);
    expect(stateDispatches.get('d-1')?.status).toBe('done');
  });

  it('does not change status when run is active', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [],
      status: 'working',
    });
    byState.set('state-1', stateDispatches);

    markInactiveAsDone(byState, true);
    expect(stateDispatches.get('d-1')?.status).toBe('working');
  });

  it('does not change error status', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [],
      status: 'error',
    });
    byState.set('state-1', stateDispatches);

    markInactiveAsDone(byState, false);
    expect(stateDispatches.get('d-1')?.status).toBe('error');
  });
});

describe('groupDispatchesIntoParallelRounds', () => {
  it('returns empty map for empty input', () => {
    const result = groupDispatchesIntoParallelRounds(new Map());
    expect(result.size).toBe(0);
  });

  it('does not create a phase for a single role', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ timestamp: '2024-01-01T00:00:00Z' })],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    const result = groupDispatchesIntoParallelRounds(byState);
    expect(result.size).toBe(0);
  });

  it('creates a parallel phase for two different roles in same round', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:01Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:10Z' }),
      ],
      status: 'done',
    });
    stateDispatches.set('d-2', {
      roleId: 'coder',
      dispatchId: 'd-2',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:02Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:09Z' }),
      ],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    const result = groupDispatchesIntoParallelRounds(byState);
    expect(result.size).toBe(1);
    expect(result.has('state-1')).toBe(true);
    const phase = result.get('state-1');
    expect(phase?.dispatches.size).toBe(2);
  });

  it('groups sequential rounds and only reports parallel ones', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:01Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:05Z' }),
      ],
      status: 'done',
    });
    stateDispatches.set('d-2', {
      roleId: 'coder',
      dispatchId: 'd-2',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:02Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:04Z' }),
      ],
      status: 'done',
    });
    stateDispatches.set('d-3', {
      roleId: 'tester',
      dispatchId: 'd-3',
      lines: [makeLine({ timestamp: '2024-01-01T00:00:10Z' })],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    const result = groupDispatchesIntoParallelRounds(byState);
    expect(result.has('state-1')).toBe(true);
    const phase = result.get('state-1');
    expect(phase?.dispatches.has('d-1')).toBe(true);
    expect(phase?.dispatches.has('d-2')).toBe(true);
  });

  it('keeps a slow dispatch in the same round when startedAt is within the round', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:01Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:10Z' }),
      ],
      status: 'done',
    });
    stateDispatches.set('d-2', {
      roleId: 'coder',
      dispatchId: 'd-2',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:02Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:09Z' }),
      ],
      status: 'done',
    });
    stateDispatches.set('d-3', {
      roleId: 'performance_reviewer',
      dispatchId: 'd-3',
      startedAt: '2024-01-01T00:00:03Z',
      lines: [
        makeLine({ timestamp: '2024-01-01T00:00:20Z' }),
        makeLine({ timestamp: '2024-01-01T00:00:30Z' }),
      ],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    const result = groupDispatchesIntoParallelRounds(byState);
    expect(result.has('state-1')).toBe(true);
    const phase = result.get('state-1');
    expect(phase?.dispatches.size).toBe(3);
    expect(phase?.dispatches.has('d-3')).toBe(true);
  });
});

describe('populateDispatchStartTimes', () => {
  it('sets startedAt from the earliest line across all lines', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1', timestamp: '2024-01-01T00:01:00Z' })],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    const allLines = [
      makeLine({ dispatchId: 'd-1', timestamp: '2024-01-01T00:00:05Z' }),
      makeLine({ dispatchId: 'd-1', timestamp: '2024-01-01T00:01:00Z' }),
    ];

    populateDispatchStartTimes(byState, allLines);
    expect(stateDispatches.get('d-1')?.startedAt).toBe('2024-01-01T00:00:05Z');
  });

  it('does not set startedAt when no matching lines exist', () => {
    const byState = new Map<string, Map<string, MutableDispatch>>();
    const stateDispatches = new Map<string, MutableDispatch>();
    stateDispatches.set('d-1', {
      roleId: 'reviewer',
      dispatchId: 'd-1',
      lines: [makeLine({ dispatchId: 'd-1', timestamp: '2024-01-01T00:01:00Z' })],
      status: 'done',
    });
    byState.set('state-1', stateDispatches);

    populateDispatchStartTimes(byState, []);
    expect(stateDispatches.get('d-1')?.startedAt).toBeUndefined();
  });
});
