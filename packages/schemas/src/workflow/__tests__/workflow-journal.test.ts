import { describe, expect, it } from 'vitest';

import {
  artifactEventDataSchema,
  artifactStalenessDataSchema,
  errorDataSchema,
  findingEventDataSchema,
  governanceEventDataSchema,
  humanEventDataSchema,
  journalEventDataSchema,
  journalEventTypeSchema,
  journalFilterSchema,
  runLifecycleDataSchema,
  stateTransitionDataSchema,
  workerEventDataSchema,
} from '../workflow-journal';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('journalEventTypeSchema', () => {
  it.each([
    'run_started',
    'run_completed',
    'run_aborted',
    'run_resumed',
    'state_transition',
    'worker_dispatched',
    'worker_completed',
    'worker_failed',
    'worker_retried',
    'artifact_stored',
    'artifact_staleness_detected',
    'governance_decision',
    'agreement_produced',
    'escalation',
    'finding_raised',
    'finding_resolved',
    'human_input_requested',
    'human_input_received',
    'human_approval',
    'human_rejection',
    'error',
  ])('accepts "%s"', (val) => {
    expect(journalEventTypeSchema.safeParse(val).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(journalEventTypeSchema.safeParse('custom_event').success).toBe(false);
  });
});

describe('runLifecycleDataSchema', () => {
  it('validates a run started event', () => {
    const data = { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' };
    expect(runLifecycleDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates a run completed event', () => {
    const data = {
      kind: 'run_lifecycle',
      workflowName: 'default',
      workflowVersion: '1.0.0',
      status: 'completed',
      finalState: 'DONE',
    };
    expect(runLifecycleDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates a run aborted event', () => {
    const data = {
      kind: 'run_lifecycle',
      workflowName: 'default',
      workflowVersion: '1.0.0',
      status: 'aborted',
      reason: 'User cancelled',
    };
    expect(runLifecycleDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('stateTransitionDataSchema', () => {
  it('validates a transition event', () => {
    const data = {
      kind: 'state_transition',
      from: 'IMPL',
      to: 'REVIEW',
      trigger: 'completion',
      durationMs: 100,
      guardsEvaluated: 2,
      guardsPassed: 2,
      governanceRequired: true,
      governanceOutcome: 'allowed',
    };
    expect(stateTransitionDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates without optional fields', () => {
    const data = {
      kind: 'state_transition',
      from: 'A',
      to: 'B',
      trigger: 'completion',
      durationMs: 50,
      guardsEvaluated: 0,
      guardsPassed: 0,
      governanceRequired: false,
    };
    expect(stateTransitionDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerEventDataSchema', () => {
  it('validates a dispatched event', () => {
    const data = {
      kind: 'worker',
      workerId: 'w-1',
      role: 'implementer',
      stateId: 'IMPL',
      status: 'dispatched',
    };
    expect(workerEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates a completed event with metrics', () => {
    const data = {
      kind: 'worker',
      workerId: 'w-1',
      role: 'implementer',
      stateId: 'IMPL',
      status: 'completed',
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 5000,
      outputArtifacts: [validRef],
    };
    expect(workerEventDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactEventDataSchema', () => {
  it('validates an artifact stored event', () => {
    const data = {
      kind: 'artifact',
      artifactRef: validRef,
      producedBy: 'architect',
      sizeBytes: 1024,
    };
    expect(artifactEventDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('governanceEventDataSchema', () => {
  it('validates a governance decision event', () => {
    const data = {
      kind: 'governance',
      outcome: 'allowed',
      reason: 'All policies passed',
      transitionFrom: 'IMPL',
      transitionTo: 'REVIEW',
      policiesEvaluated: 3,
    };
    expect(governanceEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates an escalation event', () => {
    const data = {
      kind: 'governance',
      outcome: 'escalated',
      reason: 'Too many iterations',
      escalationReason: 'iteration_limit_exceeded',
    };
    expect(governanceEventDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingEventDataSchema', () => {
  it('validates a finding raised event', () => {
    const data = {
      kind: 'finding',
      findingId: 'f-1',
      severity: 'high',
      status: 'open',
      title: 'SQL Injection',
      blocking: 'must_fix',
    };
    expect(findingEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates a finding resolved event', () => {
    const data = {
      kind: 'finding',
      findingId: 'f-1',
      severity: 'high',
      status: 'addressed',
      title: 'SQL Injection',
      blocking: 'must_fix',
      resolvedBy: 'implementer',
    };
    expect(findingEventDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('humanEventDataSchema', () => {
  it('validates a human input requested event', () => {
    const data = {
      kind: 'human',
      action: 'input_requested',
      stateId: 'WAIT',
      reason: 'Need clarification',
    };
    expect(humanEventDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('errorDataSchema', () => {
  it('validates an error event', () => {
    const data = {
      kind: 'error',
      errorCode: 'PROVIDER_TIMEOUT',
      message: 'Model timed out',
      stateId: 'IMPL',
      recoverable: true,
    };
    expect(errorDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('artifactStalenessDataSchema', () => {
  it('validates an artifact staleness event', () => {
    const data = {
      kind: 'artifact_staleness',
      trigger: 'plan/main-plan@v1',
      staleCount: 2,
      rebuildOrder: ['implementation', 'review_report'],
    };
    expect(artifactStalenessDataSchema.safeParse(data).success).toBe(true);
  });
});

describe('journalEventDataSchema (discriminated union)', () => {
  it('validates run_lifecycle data', () => {
    const data = { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0' };
    expect(journalEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates worker data', () => {
    const data = { kind: 'worker', workerId: 'w-1', role: 'x', stateId: 'S', status: 'done' };
    expect(journalEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('validates artifact_staleness data', () => {
    const data = {
      kind: 'artifact_staleness',
      trigger: 'plan/main@v1',
      staleCount: 1,
      rebuildOrder: ['impl'],
    };
    expect(journalEventDataSchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const data = { kind: 'unknown', foo: 'bar' };
    expect(journalEventDataSchema.safeParse(data).success).toBe(false);
  });
});

describe('journalFilterSchema', () => {
  it('validates an empty filter (all optional)', () => {
    expect(journalFilterSchema.safeParse({}).success).toBe(true);
  });

  it('validates with filters', () => {
    const data = {
      eventType: 'worker_completed',
      stateId: 'IMPL',
      role: 'implementer',
      after: '2026-01-01T00:00:00Z',
      before: '2026-01-02T00:00:00Z',
    };
    expect(journalFilterSchema.safeParse(data).success).toBe(true);
  });
});
