import type { JournalEvent } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  type RebuildContext,
  applyArtifactStored,
  applyFinding,
  applyHumanInputRequested,
  applyHumanResponse,
  applyRunStarted,
  applyStateTransition,
} from '../../src/infrastructure/state-persistence/state-rebuilder';

function createContext(overrides: Partial<RebuildContext> = {}): RebuildContext {
  return {
    currentState: 'INTAKE',
    previousState: null,
    stateEnteredAt: '2025-01-01T00:00:00Z',
    transitionCount: 0,
    stateHistory: [],
    iterationCounts: {},
    judgeArbitrationCounts: {},
    artifactMap: new Map(),
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    waitingContext: undefined,
    ...overrides,
  };
}

function makeEvent<T extends JournalEvent['type']>(
  type: T,
  data: Extract<JournalEvent, { type: T }>['data'],
  timestamp = '2025-01-01T00:01:00Z',
): Extract<JournalEvent, { type: T }> {
  return { type, data, timestamp, runId: 'run-1', sequence: 1 } as Extract<
    JournalEvent,
    { type: T }
  >;
}

describe('applyRunStarted', () => {
  it('sets workflowName and workflowVersion', () => {
    const ctx = createContext();
    const event = makeEvent('run_started', {
      kind: 'run_lifecycle',
      workflowName: 'my-workflow',
      workflowVersion: '2.0.0',
    });
    applyRunStarted(ctx, event);
    expect(ctx.workflowName).toBe('my-workflow');
    expect(ctx.workflowVersion).toBe('2.0.0');
  });
});

describe('applyStateTransition', () => {
  it('updates current/previous state and increments transition count', () => {
    const ctx = createContext();
    const event = makeEvent('state_transition', {
      kind: 'state_transition',
      from: 'INTAKE',
      to: 'CODING',
      trigger: 'completion',
      durationMs: 100,
      guardsEvaluated: 1,
      guardsPassed: 1,
      governanceRequired: false,
    });
    applyStateTransition(ctx, event);
    expect(ctx.currentState).toBe('CODING');
    expect(ctx.previousState).toBe('INTAKE');
    expect(ctx.transitionCount).toBe(1);
    expect(ctx.stateEnteredAt).toBe('2025-01-01T00:01:00Z');
    expect(ctx.stateHistory).toEqual(['INTAKE', 'CODING']);
  });

  it('increments judgeArbitrationCounts for JUDGE_REVIEW with contractId', () => {
    const ctx = createContext();
    const event = makeEvent('state_transition', {
      kind: 'state_transition',
      from: 'CODING',
      to: 'JUDGE_REVIEW',
      trigger: 'completion',
      durationMs: 50,
      guardsEvaluated: 1,
      guardsPassed: 1,
      governanceRequired: false,
      contractId: 'contract-1',
    });
    applyStateTransition(ctx, event);
    expect(ctx.judgeArbitrationCounts['contract-1']).toBe(1);

    applyStateTransition(ctx, event);
    expect(ctx.judgeArbitrationCounts['contract-1']).toBe(2);
  });

  it('does not duplicate entries in stateHistory', () => {
    const ctx = createContext({ stateHistory: ['INTAKE'] });
    const event = makeEvent('state_transition', {
      kind: 'state_transition',
      from: 'INTAKE',
      to: 'CODING',
      trigger: 'completion',
      durationMs: 50,
      guardsEvaluated: 1,
      guardsPassed: 1,
      governanceRequired: false,
    });
    applyStateTransition(ctx, event);
    expect(ctx.stateHistory).toEqual(['INTAKE', 'CODING']);
  });
});

describe('applyArtifactStored', () => {
  it('stores artifact ref in map and sets lastProducedArtifact', () => {
    const ctx = createContext();
    const ref = {
      type: 'implementation' as const,
      name: 'code.ts',
      version: 1,
      checksum: 'abc123',
    };
    const event = makeEvent('artifact_stored', {
      kind: 'artifact',
      artifactRef: ref,
      producedBy: 'coder',
      sizeBytes: 1024,
    });
    applyArtifactStored(ctx, event);
    expect(ctx.artifactMap.get('implementation')).toEqual(ref);
    expect(ctx.lastProducedArtifact).toEqual(ref);
  });

  it('overwrites artifact of same type', () => {
    const ctx = createContext();
    const ref1 = { type: 'implementation' as const, name: 'v1.ts', version: 1, checksum: 'aaa' };
    const ref2 = { type: 'implementation' as const, name: 'v2.ts', version: 2, checksum: 'bbb' };
    applyArtifactStored(
      ctx,
      makeEvent('artifact_stored', {
        kind: 'artifact',
        artifactRef: ref1,
        producedBy: 'coder',
        sizeBytes: 100,
      }),
    );
    applyArtifactStored(
      ctx,
      makeEvent('artifact_stored', {
        kind: 'artifact',
        artifactRef: ref2,
        producedBy: 'coder',
        sizeBytes: 200,
      }),
    );
    expect(ctx.artifactMap.get('implementation')).toEqual(ref2);
    expect(ctx.lastProducedArtifact).toEqual(ref2);
  });
});

describe('applyFinding', () => {
  it('initializes review_loop iteration count', () => {
    const ctx = createContext();
    const event = makeEvent('finding_raised', {
      kind: 'finding',
      findingId: 'f-1',
      severity: 'high',
      status: 'open',
      title: 'Bug found',
      blocking: 'true',
    });
    applyFinding(ctx, event);
    expect(ctx.iterationCounts['review_loop']).toBe(0);
  });
});

describe('applyHumanInputRequested', () => {
  it('sets waitingContext with clarification_needed reason', () => {
    const ctx = createContext({ currentState: 'CODING', previousState: 'INTAKE' });
    const event = makeEvent('human_input_requested', {
      kind: 'human',
      action: 'request',
      stateId: 'CODING',
      reason: 'clarification_needed',
    });
    applyHumanInputRequested(ctx, event);
    expect(ctx.waitingContext).toEqual({
      reason: 'clarification_needed',
      requiredInput: 'text',
      requestingState: 'INTAKE',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2025-01-01T00:01:00Z',
    });
  });

  it('defaults reason to waiting_for_human', () => {
    const ctx = createContext({ currentState: 'CODING' });
    const event = makeEvent('human_input_requested', {
      kind: 'human',
      action: 'request',
      stateId: 'CODING',
    });
    applyHumanInputRequested(ctx, event);
    expect(ctx.waitingContext?.reason).toBe('waiting_for_human');
    expect(ctx.waitingContext?.requiredInput).toBe('approval');
    expect(ctx.waitingContext?.autoResumeSafe).toBe(true);
  });
});

describe('applyHumanResponse', () => {
  it('clears waitingContext on human_approval', () => {
    const ctx = createContext({
      waitingContext: {
        reason: 'approval_needed',
        requiredInput: 'approval',
        requestingState: 'CODING',
        autoResumeSafe: true,
        presentedArtifacts: [],
        waitingSince: '2025-01-01T00:00:00Z',
      },
    });
    const event = makeEvent('human_approval', {
      kind: 'human',
      action: 'approve',
      stateId: 'CODING',
    });
    applyHumanResponse(ctx, event);
    expect(ctx.waitingContext).toBeUndefined();
  });
});
