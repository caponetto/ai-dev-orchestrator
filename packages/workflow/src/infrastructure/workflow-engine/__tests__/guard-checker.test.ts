import type {
  ArtifactStore,
  IterationContractRegistry,
  ProjectContextStore,
} from '@ai-dev-orchestrator/ports';
import type { Guard, TransitionContext } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { GuardChecker } from '../guard-checker';

function makeArtifactStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  return {
    store: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    getLatest: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn().mockResolvedValue({ valid: true }),
    inventory: vi.fn().mockResolvedValue({ artifacts: [], totalSize: 0 }),
    ...overrides,
  };
}

function makeContractRegistry(
  overrides: Partial<IterationContractRegistry> = {},
): IterationContractRegistry {
  return {
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
}

function makeContext(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    runId: 'run-001',
    currentIteration: 0,
    stateHistory: [],
    ...overrides,
  };
}

describe('GuardChecker', () => {
  it('artifact_exists passes when artifact found', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: '',
      }),
    });
    const checker = new GuardChecker(store, makeContractRegistry());
    const guard: Guard = { type: 'artifact_exists', params: { artifactType: 'plan' } };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(true);
  });

  it('artifact_exists fails when artifact not found', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = { type: 'artifact_exists', params: { artifactType: 'plan' } };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(false);
  });

  it('state_visited passes when state in history', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = { type: 'state_visited', params: { stateId: 'PLANNING' } };
    const results = await checker.evaluateAll(
      [guard],
      makeContext({ stateHistory: ['INTAKE', 'PLANNING'] }),
    );
    expect(results[0].passed).toBe(true);
  });

  it('state_visited fails when state not in history', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = { type: 'state_visited', params: { stateId: 'DONE' } };
    const results = await checker.evaluateAll([guard], makeContext({ stateHistory: ['INTAKE'] }));
    expect(results[0].passed).toBe(false);
  });

  it('allPass returns true when all guards pass', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: '',
      }),
    });
    const checker = new GuardChecker(store, makeContractRegistry());
    const guards: Guard[] = [{ type: 'artifact_exists', params: { artifactType: 'plan' } }];
    expect(await checker.allPass(guards, makeContext())).toBe(true);
  });

  it('allPass returns false when any guard fails', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guards: Guard[] = [{ type: 'artifact_exists', params: { artifactType: 'missing' } }];
    expect(await checker.allPass(guards, makeContext())).toBe(false);
  });

  it('iteration_below_limit passes when no contract found', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = { type: 'iteration_below_limit', params: { contract: 'unknown' } };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(true);
  });

  it('iteration_below_limit passes when iteration count is below max', async () => {
    const registry = makeContractRegistry({
      getContract: vi.fn().mockReturnValue({
        id: 'plan_review',
        maxIterations: 3,
      }),
      getIterationState: vi.fn().mockReturnValue({
        contractId: 'plan_review',
        currentIteration: 1,
        judgeArbitrations: 0,
      }),
    });
    const checker = new GuardChecker(makeArtifactStore(), registry);
    const guard: Guard = { type: 'iteration_below_limit', params: { contract: 'plan_review' } };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toContain('1');
    expect(results[0].detail).toContain('3');
  });

  it('iteration_below_limit fails when iteration count reaches max', async () => {
    const registry = makeContractRegistry({
      getContract: vi.fn().mockReturnValue({
        id: 'implementation_review_loop',
        maxIterations: 5,
      }),
      getIterationState: vi.fn().mockReturnValue({
        contractId: 'implementation_review_loop',
        currentIteration: 5,
        judgeArbitrations: 0,
      }),
    });
    const checker = new GuardChecker(makeArtifactStore(), registry);
    const guard: Guard = {
      type: 'iteration_below_limit',
      params: { contract: 'implementation_review_loop' },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('limit reached');
  });

  it('artifact_version_min passes when artifact version meets minimum', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 3,
        checksum: 'abc',
        content: '',
      }),
    });
    const checker = new GuardChecker(store, makeContractRegistry());
    const guard: Guard = {
      type: 'artifact_version_min',
      params: { artifactType: 'plan', minVersion: 2 },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toContain('>= 2');
  });

  it('artifact_version_min fails when artifact version below minimum', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        type: 'plan',
        name: 'plan',
        version: 1,
        checksum: 'abc',
        content: '',
      }),
    });
    const checker = new GuardChecker(store, makeContractRegistry());
    const guard: Guard = {
      type: 'artifact_version_min',
      params: { artifactType: 'plan', minVersion: 3 },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('< 3');
  });

  it('artifact_version_min fails when artifact not found', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = {
      type: 'artifact_version_min',
      params: { artifactType: 'plan', minVersion: 1 },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('not found');
  });

  it('agreement_exists passes when agreement artifact found', async () => {
    const store = makeArtifactStore({
      getLatest: vi.fn().mockResolvedValue({
        type: 'plan_agreement',
        name: 'plan_agreement',
        version: 1,
        checksum: 'abc',
        content: '',
      }),
    });
    const checker = new GuardChecker(store, makeContractRegistry());
    const guard: Guard = {
      type: 'agreement_exists',
      params: { agreementType: 'plan_agreement' },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(true);
    expect(results[0].detail).toContain('exists');
  });

  it('agreement_exists fails when agreement artifact not found', async () => {
    const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
    const guard: Guard = {
      type: 'agreement_exists',
      params: { agreementType: 'plan_agreement' },
    };
    const results = await checker.evaluateAll([guard], makeContext());
    expect(results[0].passed).toBe(false);
    expect(results[0].detail).toContain('not found');
  });

  describe('findings_indicate_plan_issue', () => {
    it('passes when review artifact has category: plan finding', async () => {
      const ref = {
        type: 'static_review' as const,
        name: 'static_review',
        version: 1,
        checksum: 'a',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            findings: [{ category: 'plan', message: 'wrong approach' }],
          }),
          producedBy: 'static_reviewer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('plan-level');
    });

    it('passes when review artifact has severity: architectural finding', async () => {
      const ref = {
        type: 'security_review' as const,
        name: 'security_review',
        version: 1,
        checksum: 'b',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            findings: [{ severity: 'architectural', message: 'design flaw' }],
          }),
          producedBy: 'security_reviewer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(true);
    });

    it('fails when no plan-level findings exist', async () => {
      const ref = {
        type: 'static_review' as const,
        name: 'static_review',
        version: 1,
        checksum: 'c',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            findings: [{ category: 'code', message: 'style issue' }],
          }),
          producedBy: 'static_reviewer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(false);
    });

    it('fails when no artifact refs in context', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('passes with frontmatter findings containing category: plan', async () => {
      const ref = {
        type: 'plan_review' as const,
        name: 'plan_review',
        version: 1,
        checksum: 'fm1',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content:
            '---\napproved: false\nfindings:\n  - category: plan\n    severity: major\n    description: wrong approach\n---\nReview body.',
          producedBy: 'plan_reviewer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('plan-level');
    });

    it('passes when judge_decision artifact has planLevelIssue: true', async () => {
      const ref = {
        type: 'judge_decision' as const,
        name: 'judge_decision',
        version: 1,
        checksum: 'jd1',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            rationale: 'Plan is fundamentally flawed',
            directives: ['Redesign the approach'],
            reviewArtifactsConsidered: ['review-v1'],
            planLevelIssue: true,
          }),
          producedBy: 'judge',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('Judge decision');
    });

    it('fails when judge_decision has planLevelIssue: false', async () => {
      const ref = {
        type: 'judge_decision' as const,
        name: 'judge_decision',
        version: 1,
        checksum: 'jd2',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            rationale: 'Code issues only',
            directives: ['Fix the tests'],
            reviewArtifactsConsidered: ['review-v1'],
            planLevelIssue: false,
          }),
          producedBy: 'judge',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(false);
    });
  });

  describe('verification_failures_are_fixable', () => {
    it('passes when all verification failures are fixable', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'd',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            failures: [
              { fixable: true, message: 'test failure' },
              { fixable: true, message: 'lint error' },
            ],
          }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('fixable');
    });

    it('fails when some failures are not fixable', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'e',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            failures: [{ fixable: true }, { fixable: false, message: 'wrong approach' }],
          }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('fails when no verification artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('passes with frontmatter verification artifact where all failures are fixable', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'fm2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content:
            '---\npassed: false\nfailures:\n  - fixable: true\n    type: test\n    description: test failure\n---\nVerification body.',
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });
  });

  describe('verification_passed', () => {
    it('passes when passed is true (all green)', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vp1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ passed: true }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('passed');
    });

    it('passes when passed is true despite unrelated failures', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vp2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            passed: true,
            failures: [{ type: 'test', fixable: false, relatedness: 'unrelated' }],
          }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });

    it('fails when passed is false (related failures exist)', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vp3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            passed: false,
            failures: [{ type: 'test', fixable: false, relatedness: 'related' }],
          }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('fails when no verification artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No verification artifact');
    });
  });

  describe('plan_structure_valid', () => {
    it('passes when plan artifact has valid structure', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'plan',
          name: 'plan',
          version: 1,
          checksum: 'f',
          content: JSON.stringify({
            summary: 'Test plan',
            tasks: [
              { taskId: 't1', description: 'Task 1', files: ['a.ts'], dependencies: [] },
              { taskId: 't2', description: 'Task 2', files: ['b.ts'], dependencies: ['t1'] },
            ],
          }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('valid');
    });

    it('fails when plan has dependency cycle', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'plan',
          name: 'plan',
          version: 1,
          checksum: 'g',
          content: JSON.stringify({
            summary: 'Cyclic plan',
            tasks: [
              { taskId: 't1', description: 'Task 1', files: [], dependencies: ['t2'] },
              { taskId: 't2', description: 'Task 2', files: [], dependencies: ['t1'] },
            ],
          }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('invalid');
    });

    it('passes when no plan artifact exists (defers to artifact_exists guard)', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('deferred to artifact_exists');
    });

    it('passes with valid frontmatter plan', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'plan',
          name: 'plan',
          version: 1,
          checksum: 'fm3',
          content:
            '---\nsummary: Frontmatter plan\ntasks:\n  - taskId: t1\n    description: Task 1\n    files: []\n    dependencies: []\n---\nPlan body.',
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });
  });

  describe('waiting_context_matches', () => {
    it('passes when requestingState matches', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'waiting_context_matches',
        params: { requestingState: 'REFINEMENT' },
      };
      const ctx = makeContext({
        waitingContext: {
          reason: 'clarification_needed',
          requiredInput: 'text',
          requestingState: 'REFINEMENT',
          autoResumeSafe: false,
          presentedArtifacts: [],
          waitingSince: '',
        },
      });
      const results = await checker.evaluateAll([guard], ctx);
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('matches "REFINEMENT"');
    });

    it('fails when requestingState does not match', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'waiting_context_matches',
        params: { requestingState: 'CODE_REVIEW' },
      };
      const ctx = makeContext({
        waitingContext: {
          reason: 'clarification_needed',
          requiredInput: 'text',
          requestingState: 'REFINEMENT',
          autoResumeSafe: false,
          presentedArtifacts: [],
          waitingSince: '',
        },
      });
      const results = await checker.evaluateAll([guard], ctx);
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('does not match');
    });

    it('fails when no waiting context exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'waiting_context_matches',
        params: { requestingState: 'REFINEMENT' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('VERIFICATION context + human_approved triggers DONE transition correctly', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const doneGuard: Guard = {
        type: 'waiting_context_matches',
        params: { requestingState: 'VERIFICATION' },
      };
      const reqGuard: Guard = {
        type: 'waiting_context_matches',
        params: { requestingState: 'REFINEMENT' },
      };
      const ctx = makeContext({
        waitingContext: {
          reason: 'approval_needed',
          requiredInput: 'approval',
          requestingState: 'VERIFICATION',
          autoResumeSafe: true,
          presentedArtifacts: [],
          waitingSince: '',
        },
      });
      const doneResults = await checker.evaluateAll([doneGuard], ctx);
      expect(doneResults[0].passed).toBe(true);
      const reqResults = await checker.evaluateAll([reqGuard], ctx);
      expect(reqResults[0].passed).toBe(false);
    });
  });

  describe('specification_feasible', () => {
    const guard: Guard = { type: 'specification_feasible', params: {} };

    it('passes when feasibility.feasible is true', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ feasibility: { feasible: true } }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('feasible');
    });

    it('fails when feasibility.feasible is false', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({
            feasibility: { feasible: false, reason: 'Requires external API credentials' },
          }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('Requires external API credentials');
    });

    it('passes when feasibility field is missing (backward compat)', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ id: 'spec-001', version: 1 }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('No feasibility field');
    });

    it('passes when artifact does not exist (defers to artifact_exists)', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('deferred to artifact_exists');
    });
  });

  describe('artifact_exists fallback to list', () => {
    it('passes when getLatest returns null but list finds a match', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue(null),
        list: vi
          .fn()
          .mockResolvedValue([{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }]),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'artifact_exists', params: { artifactType: 'plan' } };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('exists');
    });
  });

  describe('has_clarification_needs', () => {
    const guard: Guard = { type: 'has_clarification_needs', params: {} };

    it('passes when specification has clarification needs', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({
            clarificationNeeds: ['What database to use?', 'Auth provider?'],
          }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('2 clarification need(s)');
    });

    it('fails when specification has empty clarification needs', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ clarificationNeeds: [] }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no clarification needs');
    });

    it('fails when specification has no clarificationNeeds field (treated as none)', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: JSON.stringify({ id: 'spec-001' }),
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no clarification needs');
    });

    it('fails when specification content is not parseable (no clarificationNeeds field)', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'abc',
          content: 'Plain text specification with no structured data',
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No clarificationNeeds field');
    });

    it('fails when no canonical_specification exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No canonical_specification found');
    });

    it('resolves canonical specification via list fallback', async () => {
      const specRef = {
        type: 'canonical_specification' as const,
        name: 'context_analyst-output',
        version: 1,
        checksum: 'fb1',
      };
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue(null),
        list: vi
          .fn()
          .mockImplementation((query: { type: string }) =>
            query.type === 'canonical_specification'
              ? Promise.resolve([specRef])
              : Promise.resolve([]),
          ),
        get: vi.fn().mockResolvedValue({
          ...specRef,
          content: JSON.stringify({ clarificationNeeds: ['What framework?'] }),
          producedBy: 'context_analyst',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('1 clarification need(s)');
    });
  });

  describe('synthesis_approved', () => {
    const guard: Guard = { type: 'synthesis_approved', params: {} };

    it('passes when review_report has approved: true', async () => {
      const ref = {
        type: 'review_report' as const,
        name: 'review_report',
        version: 1,
        checksum: 'sa1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ approved: true }),
          producedBy: 'review_synthesizer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('approved');
    });

    it('fails when review_report has approved: false', async () => {
      const ref = {
        type: 'review_report' as const,
        name: 'review_report',
        version: 1,
        checksum: 'sa2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ approved: false }),
          producedBy: 'review_synthesizer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('not approved');
    });

    it('fails when no review_report artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No review_report artifact');
    });

    it('fails when review_report has no parseable approved field', async () => {
      const ref = {
        type: 'review_report' as const,
        name: 'review_report',
        version: 1,
        checksum: 'sa3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Plain text report with no structured data',
          producedBy: 'review_synthesizer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable approved field');
    });

    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'review_report' as const,
        name: 'review_report',
        version: 1,
        checksum: 'sa4',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('disk error')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });
  });

  describe('acceptance_passed', () => {
    const guard: Guard = { type: 'acceptance_passed', params: {} };

    it('passes when acceptance_validation has passed: true', async () => {
      const ref = {
        type: 'acceptance_validation' as const,
        name: 'acceptance_validation',
        version: 1,
        checksum: 'ap1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ passed: true }),
          producedBy: 'acceptance_validator',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('Acceptance validation passed');
    });

    it('fails when acceptance_validation has passed: false', async () => {
      const ref = {
        type: 'acceptance_validation' as const,
        name: 'acceptance_validation',
        version: 1,
        checksum: 'ap2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ passed: false }),
          producedBy: 'acceptance_validator',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('criteria not fully met');
    });

    it('fails when no acceptance_validation artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No acceptance_validation artifact');
    });

    it('fails when acceptance_validation has no parseable passed field', async () => {
      const ref = {
        type: 'acceptance_validation' as const,
        name: 'acceptance_validation',
        version: 1,
        checksum: 'ap3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Unstructured acceptance text',
          producedBy: 'acceptance_validator',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable passed field');
    });

    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'acceptance_validation' as const,
        name: 'acceptance_validation',
        version: 1,
        checksum: 'ap4',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('corrupt artifact')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });
  });

  describe('triage_indicates_plan_issue', () => {
    const guard: Guard = { type: 'triage_indicates_plan_issue', params: {} };

    it('passes when remediation_plan has planLevelIssue: true', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'tp1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ planLevelIssue: true }),
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('indicates plan-level issue');
    });

    it('fails when remediation_plan has planLevelIssue: false', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'tp2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ planLevelIssue: false }),
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('does not indicate plan-level issue');
    });

    it('fails when no remediation_plan artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No remediation_plan artifact');
    });

    it('fails when remediation_plan has no parseable planLevelIssue field', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'tp3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Plain text remediation plan',
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable planLevelIssue field');
    });

    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'tp4',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('read error')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });
  });

  describe('triage_needs_human', () => {
    const guard: Guard = { type: 'triage_needs_human', params: {} };

    it('passes when remediation_plan has needsHuman: true', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'th1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ needsHuman: true }),
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('requires human input');
    });

    it('fails when remediation_plan has needsHuman: false', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'th2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ needsHuman: false }),
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('does not require human input');
    });

    it('fails when no remediation_plan artifact exists', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No remediation_plan artifact');
    });

    it('fails when remediation_plan has no parseable needsHuman field', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'th3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Plain text remediation plan',
          producedBy: 'triage',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable needsHuman field');
    });

    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'remediation_plan' as const,
        name: 'remediation_plan',
        version: 1,
        checksum: 'th4',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('io error')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });
  });

  describe('findings_indicate_plan_issue edge cases', () => {
    it('passes when design + critical finding exists', async () => {
      const ref = {
        type: 'design_review' as const,
        name: 'design_review',
        version: 1,
        checksum: 'dc1',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({
            approved: false,
            findings: [{ category: 'design', severity: 'critical', message: 'fatal design flaw' }],
          }),
          producedBy: 'design_reviewer',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(true);
    });

    it('handles get() error gracefully and returns false', async () => {
      const ref = {
        type: 'static_review' as const,
        name: 'static_review',
        version: 1,
        checksum: 'err1',
      };
      const store = makeArtifactStore({
        get: vi.fn().mockRejectedValue(new Error('artifact not found')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'findings_indicate_plan_issue', params: {} };
      const results = await checker.evaluateAll([guard], makeContext({ artifactRefs: [ref] }));
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No plan-level findings');
    });
  });

  describe('plan_structure_valid edge cases', () => {
    it('falls back to list when getLatest returns null and resolves from list', async () => {
      const planRef = {
        type: 'plan' as const,
        name: 'planner-output',
        version: 1,
        checksum: 'ps1',
      };
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue(null),
        list: vi
          .fn()
          .mockImplementation((query: { type: string }) =>
            query.type === 'plan' ? Promise.resolve([planRef]) : Promise.resolve([]),
          ),
        get: vi.fn().mockResolvedValue({
          ...planRef,
          content: JSON.stringify({
            summary: 'Plan from list',
            tasks: [{ taskId: 't1', description: 'Task 1', files: ['a.ts'], dependencies: [] }],
          }),
          producedBy: 'planner',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('valid');
    });

    it('passes when plan content is non-structured text (DAG validation skipped)', async () => {
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'plan',
          name: 'plan',
          version: 1,
          checksum: 'ps2',
          content: 'Just a plain text plan with no JSON or frontmatter tasks.',
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('DAG validation skipped');
    });

    it('handles get() error in list fallback gracefully', async () => {
      const planRef = {
        type: 'plan' as const,
        name: 'planner-output',
        version: 1,
        checksum: 'ps3',
      };
      const store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue(null),
        list: vi
          .fn()
          .mockImplementation((query: { type: string }) =>
            query.type === 'plan' ? Promise.resolve([planRef]) : Promise.resolve([]),
          ),
        get: vi.fn().mockRejectedValue(new Error('corrupt artifact')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'plan_structure_valid', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('deferred to artifact_exists');
    });
  });

  describe('specification_feasible edge cases', () => {
    it('passes when parse error occurs (treats as feasible)', async () => {
      const _store = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'sf1',
          // content that will cause the getter to throw (non-object content for get)
        }),
        get: vi.fn().mockRejectedValue(new Error('corrupt spec')),
      });
      // Need to mock getLatest to return something that causes parse to fail
      const storeWithBadContent = makeArtifactStore({
        getLatest: vi.fn().mockResolvedValue({
          type: 'canonical_specification',
          name: 'canonical_specification',
          version: 1,
          checksum: 'sf1',
          content: '{{not valid json or frontmatter',
        }),
      });
      const checker = new GuardChecker(storeWithBadContent, makeContractRegistry());
      const guard: Guard = { type: 'specification_feasible', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      // parseTypedArtifactContent returns null for unparseable content,
      // so it hits the !parsed?.feasibility branch
      expect(results[0].passed).toBe(true);
    });
  });

  describe('verification_failures_are_fixable edge cases', () => {
    it('fails when failures array is empty', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vf1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: JSON.stringify({ failures: [] }),
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('not fixable');
    });

    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vf2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('read error')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('fails when content has no parseable failures field', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vf3',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Plain text verification output',
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_failures_are_fixable', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable failures');
    });
  });

  describe('verification_passed edge cases', () => {
    it('fails when get() throws an error', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vpe1',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockRejectedValue(new Error('disk error')),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
    });

    it('fails when content has no parseable passed field', async () => {
      const ref = {
        type: 'verification' as const,
        name: 'verification',
        version: 1,
        checksum: 'vpe2',
      };
      const store = makeArtifactStore({
        list: vi.fn().mockResolvedValue([ref]),
        get: vi.fn().mockResolvedValue({
          ...ref,
          content: 'Unstructured verification output',
          producedBy: 'verifier',
          createdAt: '',
          sizeBytes: 0,
        }),
      });
      const checker = new GuardChecker(store, makeContractRegistry());
      const guard: Guard = { type: 'verification_passed', params: {} };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('no parseable passed field');
    });
  });

  describe('previous_run_pattern', () => {
    it('fails when no context store is configured', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'previous_run_pattern',
        params: { outcome: 'failed' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No project context store');
    });

    it('delegates to context guard when store is provided', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue({
          category: 'run_history',
          content: {
            lastUpdated: '2026-08-10T00:00:00Z',
            runs: [
              {
                runId: 'r1',
                outcome: 'failed',
                workflowVariant: 'dev',
                taskSummary: 'task',
                timestamp: '',
                compressed: false,
              },
            ],
          },
          lastUpdated: '2026-08-10T00:00:00Z',
        }),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'previous_run_pattern',
        params: { outcome: 'failed' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });
  });

  describe('known_failure_pattern', () => {
    it('fails when no context store is configured', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'known_failure_pattern',
        params: { patternSubstring: 'timeout' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No project context store');
    });

    it('delegates to context guard when store is provided', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue({
          category: 'preferences',
          content: {
            lastUpdated: '2026-08-10T00:00:00Z',
            modelCalibration: [],
            failurePatterns: [
              { pattern: 'Timeout in API calls', frequency: 2, lastSeen: '2026-08-10T00:00:00Z' },
            ],
            projectPreferences: [],
          },
          lastUpdated: '2026-08-10T00:00:00Z',
        }),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'known_failure_pattern',
        params: { patternSubstring: 'timeout' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });
  });

  describe('confidence_threshold', () => {
    it('passes when confidence score meets threshold', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      checker.setLastConfidenceReport({
        score: 0.85,
        criteriaResults: [],
        rationale: 'High confidence',
      });
      const guard: Guard = {
        type: 'confidence_threshold',
        params: { minConfidence: 0.7 },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('>= 0.7');
    });

    it('fails when confidence score is below threshold', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      checker.setLastConfidenceReport({
        score: 0.3,
        criteriaResults: [],
        rationale: 'Low confidence',
      });
      const guard: Guard = {
        type: 'confidence_threshold',
        params: { minConfidence: 0.7 },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('< 0.7');
    });

    it('fails when no confidence report available', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'confidence_threshold',
        params: { minConfidence: 0.5 },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No confidence report');
    });
  });

  describe('project_context_available', () => {
    it('passes when specific category exists', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue({
          category: 'run_history',
          content: { lastUpdated: '', runs: [] },
          lastUpdated: '',
        }),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'project_context_available',
        params: { category: 'run_history' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
      expect(results[0].detail).toContain('"run_history" is available');
    });

    it('fails when specific category does not exist', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'project_context_available',
        params: { category: 'codebase' },
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('"codebase" not found');
    });

    it('passes when any category exists (no category specified)', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockImplementation((category: string) =>
          category === 'run_history'
            ? Promise.resolve({
                category: 'run_history',
                content: { lastUpdated: '', runs: [] },
                lastUpdated: '',
              })
            : Promise.resolve(null),
        ),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'project_context_available',
        params: {},
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(true);
    });

    it('fails when no categories exist and no category specified', async () => {
      const contextStore: ProjectContextStore = {
        initialize: vi.fn(),
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
        query: vi.fn(),
        getProjectHash: vi.fn().mockReturnValue('abc'),
      };
      const checker = new GuardChecker(
        makeArtifactStore(),
        makeContractRegistry(),
        undefined,
        contextStore,
      );
      const guard: Guard = {
        type: 'project_context_available',
        params: {},
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No project context data found');
    });

    it('fails when no context store is configured', async () => {
      const checker = new GuardChecker(makeArtifactStore(), makeContractRegistry());
      const guard: Guard = {
        type: 'project_context_available',
        params: {},
      };
      const results = await checker.evaluateAll([guard], makeContext());
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain('No project context store');
    });
  });
});
