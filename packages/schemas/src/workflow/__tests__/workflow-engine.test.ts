import { describe, expect, it } from 'vitest';

import {
  actionSchema,
  actionTypeSchema,
  dispatchDynamicWorkersActionSchema,
  dispatchWorkerActionSchema,
  engineStateSchema,
  evaluatedTransitionSchema,
  guardResultSchema,
  guardSchema,
  guardTypeSchema,
  humanInputSchema,
  stateDefinitionSchema,
  stateTypeSchema,
  transitionContextSchema,
  transitionDefinitionSchema,
  transitionRecordSchema,
  transitionTriggerSchema,
  waitingContextSchema,
  workerResultSchema,
  workflowDefinitionSchema,
  workflowRunConfigSchema,
} from '../workflow-engine';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('stateTypeSchema', () => {
  it.each(['action', 'review', 'judge', 'gate', 'wait', 'terminal'])('accepts "%s"', (val) => {
    expect(stateTypeSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(stateTypeSchema.safeParse('parallel').success).toBe(false);
  });
});

describe('transitionTriggerSchema', () => {
  it.each([
    'completion',
    'failure',
    'review_approved',
    'review_rejected',
    'iteration_exhausted',
    'judge_approved',
    'judge_rejected',
    'escalation',
    'human_input',
    'human_approved',
    'human_rejected',
    'timeout',
  ])('accepts "%s"', (val) => {
    expect(transitionTriggerSchema.safeParse(val).success).toBe(true);
  });
});

describe('guardTypeSchema', () => {
  it('accepts valid guard types', () => {
    expect(guardTypeSchema.safeParse('artifact_exists').success).toBe(true);
    expect(guardTypeSchema.safeParse('iteration_below_limit').success).toBe(true);
    expect(guardTypeSchema.safeParse('verification_passed').success).toBe(true);
  });
});

describe('actionTypeSchema', () => {
  it('accepts valid action types', () => {
    expect(actionTypeSchema.safeParse('dispatch_worker').success).toBe(true);
    expect(actionTypeSchema.safeParse('store_artifact').success).toBe(true);
    expect(actionTypeSchema.safeParse('produce_manifest').success).toBe(true);
  });

  it('accepts dispatch_dynamic_workers', () => {
    expect(actionTypeSchema.safeParse('dispatch_dynamic_workers').success).toBe(true);
  });
});

describe('guardSchema (discriminated union)', () => {
  it('validates artifact_exists guard', () => {
    const data = { type: 'artifact_exists', params: { artifactType: 'plan' } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('validates artifact_version_min guard', () => {
    const data = { type: 'artifact_version_min', params: { artifactType: 'plan', minVersion: 2 } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('validates agreement_exists guard', () => {
    const data = { type: 'agreement_exists', params: { agreementType: 'planning_agreement' } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('validates state_visited guard', () => {
    const data = { type: 'state_visited', params: { stateId: 'SPEC' } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('validates iteration_below_limit guard', () => {
    const data = { type: 'iteration_below_limit', params: { contract: 'review-1' } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('validates verification_passed guard with waitForAll', () => {
    const data = { type: 'verification_passed', params: { waitForAll: true } };
    expect(guardSchema.safeParse(data).success).toBe(true);
  });

  it('rejects unknown guard type', () => {
    const data = { type: 'custom_guard', params: {} };
    expect(guardSchema.safeParse(data).success).toBe(false);
  });
});

describe('dispatchDynamicWorkersActionSchema', () => {
  it('validates a complete dispatch_dynamic_workers action', () => {
    const action = {
      type: 'dispatch_dynamic_workers',
      params: {
        role: 'task_spec_writer',
        sourceArtifact: 'task_breakdown',
        itemsPath: 'tasks',
      },
    };
    expect(dispatchDynamicWorkersActionSchema.safeParse(action).success).toBe(true);
  });

  it('rejects missing required params', () => {
    const action = {
      type: 'dispatch_dynamic_workers',
      params: { role: 'task_spec_writer' },
    };
    expect(dispatchDynamicWorkersActionSchema.safeParse(action).success).toBe(false);
  });
});

describe('actionSchema (discriminated union)', () => {
  it('validates dispatch_worker action', () => {
    const data = { type: 'dispatch_worker', params: { role: 'implementer' } };
    expect(actionSchema.safeParse(data).success).toBe(true);
    expect(dispatchWorkerActionSchema.safeParse(data).success).toBe(true);
  });

  it('validates dispatch_parallel_workers action', () => {
    const data = {
      type: 'dispatch_parallel_workers',
      params: { roles: ['static_reviewer', 'security_reviewer'] },
    };
    expect(actionSchema.safeParse(data).success).toBe(true);
  });

  it('validates dispatch_dynamic_workers action', () => {
    const action = {
      type: 'dispatch_dynamic_workers',
      params: {
        role: 'task_spec_writer',
        sourceArtifact: 'task_breakdown',
        itemsPath: 'tasks',
      },
    };
    expect(actionSchema.safeParse(action).success).toBe(true);
  });

  it('validates store_artifact action', () => {
    const data = { type: 'store_artifact', params: { type: 'plan', content: '# Plan' } };
    expect(actionSchema.safeParse(data).success).toBe(true);
  });

  it('validates produce_manifest action', () => {
    const data = { type: 'produce_manifest', params: {} };
    expect(actionSchema.safeParse(data).success).toBe(true);
  });

  it('validates notify_human action', () => {
    const data = { type: 'notify_human', params: { reason: 'Approval needed' } };
    expect(actionSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionDefinitionSchema', () => {
  it('validates a transition definition', () => {
    const data = {
      target: 'CODE_REVIEW',
      trigger: 'completion',
      guards: [{ type: 'artifact_exists', params: { artifactType: 'implementation' } }],
      governanceRequired: true,
      priority: 0,
    };
    expect(transitionDefinitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('stateDefinitionSchema', () => {
  it('validates a state definition', () => {
    const data = {
      type: 'action',
      description: 'Implement the feature',
      transitions: [
        {
          target: 'REVIEW',
          trigger: 'completion',
          guards: [],
          governanceRequired: false,
          priority: 0,
        },
      ],
    };
    expect(stateDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates with entry/exit actions', () => {
    const data = {
      type: 'action',
      label: 'Implementation',
      description: 'Implement the feature',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'implementer' } }],
      exitActions: [{ type: 'record_journal', params: { event: 'run_completed' } }],
      transitions: [],
    };
    expect(stateDefinitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('workflowDefinitionSchema', () => {
  it('validates a minimal workflow', () => {
    const data = {
      name: 'default',
      version: '1.0.0',
      states: {
        START: {
          type: 'action',
          description: 'Starting state',
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              governanceRequired: false,
              priority: 0,
            },
          ],
        },
        DONE: {
          type: 'terminal',
          description: 'Final state',
          transitions: [],
        },
      },
      initialState: 'START',
      terminalStates: ['DONE'],
    };
    expect(workflowDefinitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('waitingContextSchema', () => {
  it('validates a waiting context', () => {
    const data = {
      reason: 'Need approval',
      requiredInput: 'approval',
      requestingState: 'WAIT',
      autoResumeSafe: false,
      presentedArtifacts: [],
      waitingSince: '2026-01-01T00:00:00Z',
    };
    expect(waitingContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('engineStateSchema', () => {
  it('validates engine state', () => {
    const data = {
      runId: 'r-1',
      currentState: 'IMPL',
      previousState: 'SPEC',
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 2,
      isWaitingForHuman: false,
    };
    expect(engineStateSchema.safeParse(data).success).toBe(true);
  });

  it('validates with null previousState', () => {
    const data = {
      runId: 'r-1',
      currentState: 'SPEC',
      previousState: null,
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 0,
      isWaitingForHuman: false,
    };
    expect(engineStateSchema.safeParse(data).success).toBe(true);
  });
});

describe('humanInputSchema', () => {
  it('validates text input', () => {
    const data = { type: 'text', content: 'Focus on performance' };
    expect(humanInputSchema.safeParse(data).success).toBe(true);
  });

  it('validates approval with artifact ref', () => {
    const data = { type: 'approval', content: 'LGTM', artifactRef: validRef };
    expect(humanInputSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid type', () => {
    expect(humanInputSchema.safeParse({ type: 'comment', content: 'x' }).success).toBe(false);
  });
});

describe('workflowRunConfigSchema', () => {
  it('validates a run config', () => {
    const data = {
      runId: 'r-1',
      workflowDefinition: {
        name: 'default',
        version: '1.0.0',
        states: {
          START: { type: 'action', description: 'S', transitions: [] },
        },
        initialState: 'START',
        terminalStates: ['START'],
      },
      governancePolicy: {},
      roleAssignments: { architect: 'gpt-4' },
      sources: ['config.yaml'],
    };
    expect(workflowRunConfigSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionContextSchema', () => {
  it('validates a transition context', () => {
    const data = {
      runId: 'r-1',
      currentIteration: 1,
      stateHistory: ['SPEC', 'IMPL'],
    };
    expect(transitionContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('guardResultSchema', () => {
  it('validates a guard result', () => {
    const data = {
      guard: { type: 'artifact_exists', params: { artifactType: 'plan' } },
      passed: true,
      detail: 'Plan artifact found',
    };
    expect(guardResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('evaluatedTransitionSchema', () => {
  it('validates an evaluated transition', () => {
    const data = {
      definition: {
        target: 'REVIEW',
        trigger: 'completion',
        guards: [],
        governanceRequired: false,
        priority: 0,
      },
      guardsResult: [],
    };
    expect(evaluatedTransitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('workerResultSchema', () => {
  it('validates a successful worker result', () => {
    const data = { role: 'implementer', success: true, artifactRef: validRef };
    expect(workerResultSchema.safeParse(data).success).toBe(true);
  });

  it('validates a failed worker result', () => {
    const data = { role: 'implementer', success: false, error: 'Timeout', errorType: 'timeout' };
    expect(workerResultSchema.safeParse(data).success).toBe(true);
  });
});

describe('transitionRecordSchema', () => {
  it('validates a transition record', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'r-1',
      from: 'IMPL',
      to: 'REVIEW',
      trigger: 'completion',
      guardsEvaluated: [],
      durationMs: 100,
    };
    expect(transitionRecordSchema.safeParse(data).success).toBe(true);
  });

  it('validates a transition record with actionResults', () => {
    const data = {
      timestamp: '2026-01-01T00:00:00Z',
      runId: 'r-1',
      from: 'IMPL',
      to: 'REVIEW',
      trigger: 'completion',
      guardsEvaluated: [],
      durationMs: 100,
      actionResults: [
        {
          action: { type: 'dispatch_worker', params: { role: 'implementer' } },
          success: true,
        },
      ],
    };
    expect(transitionRecordSchema.safeParse(data).success).toBe(true);
  });
});
