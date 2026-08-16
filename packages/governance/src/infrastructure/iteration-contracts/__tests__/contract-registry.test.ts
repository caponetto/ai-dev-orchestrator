import { describe, expect, it } from 'vitest';

import { DefaultIterationContractRegistry } from '../contract-registry';

describe('DefaultIterationContractRegistry', () => {
  it('loads four built-in contracts', () => {
    const registry = new DefaultIterationContractRegistry();
    expect(registry.listContracts()).toHaveLength(4);
  });

  it('retrieves contract by id', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContract('plan_review_loop');
    expect(contract).not.toBeNull();
    expect(contract?.id).toBe('plan_review_loop');
  });

  it('returns null for unknown contract id', () => {
    const registry = new DefaultIterationContractRegistry();
    expect(registry.getContract('nonexistent')).toBeNull();
  });

  it('maps PLAN_REVIEW state to plan_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('PLAN_REVIEW');
    expect(contract?.id).toBe('plan_review_loop');
  });

  it('maps CODE_REVIEW state to implementation_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('CODE_REVIEW');
    expect(contract?.id).toBe('implementation_review_loop');
  });

  it('maps JUDGE_REVIEW state to implementation_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('JUDGE_REVIEW');
    expect(contract?.id).toBe('implementation_review_loop');
  });

  it('maps IMPLEMENTATION state to implementation_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('IMPLEMENTATION');
    expect(contract?.id).toBe('implementation_review_loop');
  });

  it('maps REVIEW_SYNTHESIS state to implementation_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('REVIEW_SYNTHESIS');
    expect(contract?.id).toBe('implementation_review_loop');
  });

  it('maps TEST_AUTHORING state to implementation_review_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('TEST_AUTHORING');
    expect(contract?.id).toBe('implementation_review_loop');
  });

  it('maps REFINEMENT to clarification_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('REFINEMENT');
    expect(contract?.id).toBe('clarification_loop');
  });

  it('maps WAITING_FOR_HUMAN to clarification_loop', () => {
    const registry = new DefaultIterationContractRegistry();
    const contract = registry.getContractForState('WAITING_FOR_HUMAN');
    expect(contract?.id).toBe('clarification_loop');
  });

  it('returns null for unmapped states', () => {
    const registry = new DefaultIterationContractRegistry();
    expect(registry.getContractForState('INTAKE')).toBeNull();
    expect(registry.getContractForState('DONE')).toBeNull();
  });

  it('returns default iteration state for unknown contract', () => {
    const registry = new DefaultIterationContractRegistry();
    const state = registry.getIterationState('unknown');
    expect(state.contractId).toBe('unknown');
    expect(state.currentIteration).toBe(0);
    expect(state.status).toBe('in_progress');
  });

  it('recordStateEntry increments iteration count for mapped contract', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('PLAN_REVIEW');
    registry.recordStateEntry('PLAN_REVIEW');
    const state = registry.getIterationState('plan_review_loop');
    expect(state.currentIteration).toBe(2);
    expect(state.status).toBe('in_progress');
  });

  it('recordStateEntry is no-op for unmapped states', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('INTAKE');
    const state = registry.getIterationState('plan_review_loop');
    expect(state.currentIteration).toBe(0);
  });

  it('recordStateEntry does not increment iteration count for non-round-entry states', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('WAITING_FOR_HUMAN');

    expect(registry.getIterationCounts().size).toBe(0);
  });

  it('recordStateEntry does not increment count for IMPLEMENTATION, REVIEW_SYNTHESIS, or TEST_AUTHORING', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('IMPLEMENTATION');
    registry.recordStateEntry('REVIEW_SYNTHESIS');
    registry.recordStateEntry('TEST_AUTHORING');

    expect(registry.getIterationCounts().size).toBe(0);
  });

  it('JUDGE_REVIEW increments judge count, not iteration count', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('JUDGE_REVIEW');

    expect(registry.getIterationCounts().size).toBe(0);
    expect(registry.getJudgeArbitrationCounts().get('implementation_review_loop')).toBe(1);
  });

  it('CODE_REVIEW entry counts as 1 iteration (parallel dispatch)', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('CODE_REVIEW');

    const state = registry.getIterationState('implementation_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.status).toBe('in_progress');
  });

  it('plan review cycle counts as 1 iteration', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('PLAN_REVIEW');

    const state = registry.getIterationState('plan_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.status).toBe('in_progress');
  });

  it('clarification round + wait counts as 1 iteration', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('REFINEMENT');
    registry.recordStateEntry('WAITING_FOR_HUMAN');

    const state = registry.getIterationState('clarification_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.status).toBe('in_progress');
  });

  it('getIterationState returns in_progress when under limit', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('PLAN_REVIEW');
    const state = registry.getIterationState('plan_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.status).toBe('in_progress');
  });

  it('getIterationState returns failed when at or over limit', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('REFINEMENT');
    registry.recordStateEntry('REFINEMENT');
    registry.recordStateEntry('REFINEMENT');
    const state = registry.getIterationState('clarification_loop');
    expect(state.currentIteration).toBe(3);
    expect(state.status).toBe('failed');
  });

  it('accepts additional contracts', () => {
    const custom = {
      id: 'custom_loop',
      name: 'Custom',
      description: 'custom',
      producer: 'custom_role',
      reviewers: [],
      aggregation: 'all_must_pass' as const,
      producerInputs: [],
      producerOutput: 'release_summary' as const,
      successCondition: { type: 'no_blocking_findings' as const },
      failureCondition: { type: 'max_iterations_exceeded' as const },
      maxIterations: 1,
      maxJudgeArbitrations: 0,
      escalationPolicy: {
        action: 'abort' as const,
        produceEscalationArtifact: false,
        includeFullHistory: false,
      },
    };
    const registry = new DefaultIterationContractRegistry([custom]);
    expect(registry.listContracts()).toHaveLength(5);
    expect(registry.getContract('custom_loop')).not.toBeNull();
  });

  it('CODE_REVIEW via lifecycle path (with stateType) counts as 1 iteration', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('CODE_REVIEW', 'review');

    const state = registry.getIterationState('implementation_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.status).toBe('in_progress');
  });

  it('two CODE_REVIEW rounds via lifecycle path count as 2 iterations', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('CODE_REVIEW', 'review');
    registry.recordStateEntry('CODE_REVIEW', 'review');

    const state = registry.getIterationState('implementation_review_loop');
    expect(state.currentIteration).toBe(2);
  });

  it('JUDGE_REVIEW via lifecycle path (with stateType) increments judge count only', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('CODE_REVIEW', 'review');
    registry.recordStateEntry('JUDGE_REVIEW', 'judge');

    const state = registry.getIterationState('implementation_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.judgeArbitrations).toBe(1);
  });

  it('recordStateEntry increments judge arbitration count for JUDGE_REVIEW', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('JUDGE_REVIEW');
    const state = registry.getIterationState('implementation_review_loop');
    expect(state.judgeArbitrations).toBe(1);
    expect(state.currentIteration).toBe(0);
  });

  it('judge arbitration count reflects in getIterationState', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.recordStateEntry('CODE_REVIEW');
    registry.recordStateEntry('JUDGE_REVIEW');
    const state = registry.getIterationState('implementation_review_loop');
    expect(state.currentIteration).toBe(1);
    expect(state.judgeArbitrations).toBe(1);
  });

  it('restoreJudgeArbitrationCounts restores counts from a persisted map', () => {
    const registry = new DefaultIterationContractRegistry();
    registry.restoreJudgeArbitrationCounts(new Map([['implementation_review_loop', 3]]));
    const state = registry.getIterationState('implementation_review_loop');
    expect(state.judgeArbitrations).toBe(3);
  });

  describe('iteration count persistence', () => {
    it('getIterationCounts returns empty map initially', () => {
      const registry = new DefaultIterationContractRegistry();
      const counts = registry.getIterationCounts();
      expect(counts.size).toBe(0);
    });

    it('getIterationCounts reflects recorded state entries', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordStateEntry('PLAN_REVIEW');
      registry.recordStateEntry('PLAN_REVIEW');
      registry.recordStateEntry('CODE_REVIEW');

      const counts = registry.getIterationCounts();
      expect(counts.get('plan_review_loop')).toBe(2);
      expect(counts.get('implementation_review_loop')).toBe(1);
    });

    it('getIterationCounts returns a read-only map', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordStateEntry('PLAN_REVIEW');
      const counts = registry.getIterationCounts();
      expect(counts.get('plan_review_loop')).toBe(1);
    });

    it('restoreIterationCounts restores counts from a persisted map', () => {
      const registry = new DefaultIterationContractRegistry();
      const persisted = new Map<string, number>([
        ['plan_review_loop', 5],
        ['implementation_review_loop', 3],
      ]);

      registry.restoreIterationCounts(persisted);

      const state1 = registry.getIterationState('plan_review_loop');
      expect(state1.currentIteration).toBe(5);

      const state2 = registry.getIterationState('implementation_review_loop');
      expect(state2.currentIteration).toBe(3);
    });

    it('restoreIterationCounts overwrites existing counts', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordStateEntry('PLAN_REVIEW');
      registry.recordStateEntry('PLAN_REVIEW');

      const persisted = new Map<string, number>([['plan_review_loop', 10]]);
      registry.restoreIterationCounts(persisted);

      const state = registry.getIterationState('plan_review_loop');
      expect(state.currentIteration).toBe(10);
    });

    it('restoreIterationCounts preserves counts for contracts not in the restore map', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordStateEntry('CODE_REVIEW');

      const persisted = new Map<string, number>([['plan_review_loop', 7]]);
      registry.restoreIterationCounts(persisted);

      const counts = registry.getIterationCounts();
      expect(counts.get('plan_review_loop')).toBe(7);
      expect(counts.get('implementation_review_loop')).toBe(1);
    });

    it('recordStateEntry continues incrementing after restore', () => {
      const registry = new DefaultIterationContractRegistry();
      const persisted = new Map<string, number>([['plan_review_loop', 3]]);
      registry.restoreIterationCounts(persisted);

      registry.recordStateEntry('PLAN_REVIEW');

      const state = registry.getIterationState('plan_review_loop');
      expect(state.currentIteration).toBe(4);
    });

    it('restored counts affect iteration limit checks', () => {
      const registry = new DefaultIterationContractRegistry();
      // plan_review_loop has maxIterations=5, restoring to 5 should trigger failed
      const persisted = new Map<string, number>([['plan_review_loop', 5]]);
      registry.restoreIterationCounts(persisted);

      const state = registry.getIterationState('plan_review_loop');
      expect(state.status).toBe('failed');
    });

    it('round-trips iteration counts via getIterationCounts and restoreIterationCounts', () => {
      const registry1 = new DefaultIterationContractRegistry();
      registry1.recordStateEntry('PLAN_REVIEW');
      registry1.recordStateEntry('PLAN_REVIEW');
      registry1.recordStateEntry('CODE_REVIEW');

      const saved = registry1.getIterationCounts();

      const registry2 = new DefaultIterationContractRegistry();
      registry2.restoreIterationCounts(new Map(saved));

      const counts2 = registry2.getIterationCounts();
      expect(counts2.get('plan_review_loop')).toBe(2);
      expect(counts2.get('implementation_review_loop')).toBe(1);
    });
  });

  describe('finding tracking', () => {
    it('recordFinding tracks open findings scoped to contract', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('implementation_review_loop', 'f2', 'open');
      const state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(2);
      expect(state.findingsResolved).toBe(0);
      expect(state.findingsOpen).toBe(2);
    });

    it('recordFinding updates status when finding is resolved', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('implementation_review_loop', 'f2', 'open');
      registry.recordFinding('implementation_review_loop', 'f1', 'resolved');
      const state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(2);
      expect(state.findingsResolved).toBe(1);
      expect(state.findingsOpen).toBe(1);
    });

    it('findings are isolated across contracts', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('plan_review_loop', 'f2', 'open');
      registry.recordFinding('plan_review_loop', 'f3', 'resolved');

      const implState = registry.getIterationState('implementation_review_loop');
      expect(implState.findingsTotal).toBe(1);
      expect(implState.findingsOpen).toBe(1);
      expect(implState.findingsResolved).toBe(0);

      const planState = registry.getIterationState('plan_review_loop');
      expect(planState.findingsTotal).toBe(2);
      expect(planState.findingsOpen).toBe(1);
      expect(planState.findingsResolved).toBe(1);

      const unknownState = registry.getIterationState('unknown_contract');
      expect(unknownState.findingsTotal).toBe(0);
    });

    it('recordFinding is idempotent for same id and status', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      const state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(1);
      expect(state.findingsOpen).toBe(1);
    });

    it('handles resolving a finding that was never raised', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f-unknown', 'resolved');
      const state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(1);
      expect(state.findingsResolved).toBe(1);
      expect(state.findingsOpen).toBe(0);
    });

    it('returns zero findings when none recorded', () => {
      const registry = new DefaultIterationContractRegistry();
      const state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(0);
      expect(state.findingsResolved).toBe(0);
      expect(state.findingsOpen).toBe(0);
    });

    it('tracks multiple findings through open-to-resolved lifecycle', () => {
      const registry = new DefaultIterationContractRegistry();
      registry.recordFinding('implementation_review_loop', 'f1', 'open');
      registry.recordFinding('implementation_review_loop', 'f2', 'open');
      registry.recordFinding('implementation_review_loop', 'f3', 'open');

      let state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(3);
      expect(state.findingsOpen).toBe(3);
      expect(state.findingsResolved).toBe(0);

      registry.recordFinding('implementation_review_loop', 'f1', 'resolved');
      registry.recordFinding('implementation_review_loop', 'f3', 'resolved');

      state = registry.getIterationState('implementation_review_loop');
      expect(state.findingsTotal).toBe(3);
      expect(state.findingsOpen).toBe(1);
      expect(state.findingsResolved).toBe(2);
    });
  });
});
