import { describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_VALIDATION_LOOP,
  buildContracts,
  BUILT_IN_CONTRACTS,
  CLARIFICATION_LOOP,
  IMPLEMENTATION_REVIEW_LOOP,
  PLAN_REVIEW_LOOP,
} from '../built-in-contracts';

describe('built-in iteration contracts', () => {
  it('exports four built-in contracts', () => {
    expect(BUILT_IN_CONTRACTS).toHaveLength(4);
  });

  describe('plan_review_loop', () => {
    it('has correct identity', () => {
      expect(PLAN_REVIEW_LOOP.id).toBe('plan_review_loop');
      expect(PLAN_REVIEW_LOOP.producer).toBe('planner');
    });

    it('has one reviewer: plan_reviewer', () => {
      expect(PLAN_REVIEW_LOOP.reviewers).toHaveLength(1);
      expect(PLAN_REVIEW_LOOP.reviewers[0]?.role).toBe('plan_reviewer');
      expect(PLAN_REVIEW_LOOP.reviewers[0]?.output).toBe('plan_review');
    });

    it('produces plan artifacts', () => {
      expect(PLAN_REVIEW_LOOP.producerOutput).toBe('plan');
    });

    it('uses all_must_pass aggregation', () => {
      expect(PLAN_REVIEW_LOOP.aggregation).toBe('all_must_pass');
    });

    it('uses fallback maxIterations of 5', () => {
      expect(PLAN_REVIEW_LOOP.maxIterations).toBe(5);
    });

    it('gates on planning_agreement', () => {
      expect(PLAN_REVIEW_LOOP.completionAgreement).toBe('planning_agreement');
    });

    it('escalates to human on failure', () => {
      expect(PLAN_REVIEW_LOOP.escalationPolicy.action).toBe('escalate_to_human');
    });
  });

  describe('implementation_review_loop', () => {
    it('has correct identity', () => {
      expect(IMPLEMENTATION_REVIEW_LOOP.id).toBe('implementation_review_loop');
      expect(IMPLEMENTATION_REVIEW_LOOP.producer).toBe('implementer');
    });

    it('has seven reviewers', () => {
      expect(IMPLEMENTATION_REVIEW_LOOP.reviewers).toHaveLength(7);
      const roles = IMPLEMENTATION_REVIEW_LOOP.reviewers.map((r) => r.role);
      expect(roles).toEqual([
        'static_reviewer',
        'security_reviewer',
        'performance_reviewer',
        'adversarial_reviewer',
        'design_reviewer',
        'docs_reviewer',
        'ux_reviewer',
      ]);
    });

    it('produces implementation artifacts', () => {
      expect(IMPLEMENTATION_REVIEW_LOOP.producerOutput).toBe('implementation');
    });

    it('gates on implementation_agreement', () => {
      expect(IMPLEMENTATION_REVIEW_LOOP.completionAgreement).toBe('implementation_agreement');
    });
  });

  describe('clarification_loop', () => {
    it('has correct identity', () => {
      expect(CLARIFICATION_LOOP.id).toBe('clarification_loop');
      expect(CLARIFICATION_LOOP.producer).toBe('requirements_analyst');
    });

    it('has no reviewers', () => {
      expect(CLARIFICATION_LOOP.reviewers).toHaveLength(0);
    });

    it('uses fallback maxIterations of 3', () => {
      expect(CLARIFICATION_LOOP.maxIterations).toBe(3);
    });

    it('aborts on failure', () => {
      expect(CLARIFICATION_LOOP.escalationPolicy.action).toBe('abort');
    });

    it('has no completion agreement', () => {
      expect(CLARIFICATION_LOOP.completionAgreement).toBeUndefined();
    });
  });

  describe('acceptance_validation_loop', () => {
    it('has correct identity', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.id).toBe('acceptance_validation_loop');
      expect(ACCEPTANCE_VALIDATION_LOOP.producer).toBe('implementer');
    });

    it('has no reviewers', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.reviewers).toHaveLength(0);
    });

    it('produces implementation artifacts', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.producerOutput).toBe('implementation');
    });

    it('uses fallback maxIterations of 3', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.maxIterations).toBe(3);
    });

    it('escalates to human on failure', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.escalationPolicy.action).toBe('escalate_to_human');
    });

    it('gates on verification_agreement', () => {
      expect(ACCEPTANCE_VALIDATION_LOOP.completionAgreement).toBe('verification_agreement');
    });
  });
});

describe('buildContracts', () => {
  const customLimits = {
    maxReviewIterations: 10,
    maxJudgeArbitrations: 3,
    maxClarificationRounds: 7,
    maxAcceptanceIterations: 5,
  };

  it('applies review limits to both review loops', () => {
    const contracts = buildContracts(customLimits);
    const planReview = contracts.find((c) => c.id === 'plan_review_loop');
    const implReview = contracts.find((c) => c.id === 'implementation_review_loop');

    expect(planReview?.maxIterations).toBe(10);
    expect(planReview?.maxJudgeArbitrations).toBe(3);
    expect(implReview?.maxIterations).toBe(10);
    expect(implReview?.maxJudgeArbitrations).toBe(3);
  });

  it('applies clarification limit to clarification loop', () => {
    const contracts = buildContracts(customLimits);
    const clarification = contracts.find((c) => c.id === 'clarification_loop');

    expect(clarification?.maxIterations).toBe(7);
    expect(clarification?.maxJudgeArbitrations).toBe(0);
  });

  it('preserves structural fields', () => {
    const contracts = buildContracts(customLimits);
    const planReview = contracts.find((c) => c.id === 'plan_review_loop');

    expect(planReview).toBeDefined();
    expect(planReview?.producer).toBe('planner');
    expect(planReview?.reviewers).toHaveLength(1);
    expect(planReview?.escalationPolicy.action).toBe('escalate_to_human');
    expect(planReview?.completionAgreement).toBe('planning_agreement');
  });

  it('returns four contracts', () => {
    const contracts = buildContracts(customLimits);
    expect(contracts).toHaveLength(4);
  });

  it('applies acceptance limit to acceptance validation loop', () => {
    const contracts = buildContracts(customLimits);
    const acceptance = contracts.find((c) => c.id === 'acceptance_validation_loop');

    expect(acceptance?.maxIterations).toBe(5);
    expect(acceptance?.maxJudgeArbitrations).toBe(0);
    expect(acceptance?.escalationPolicy.action).toBe('escalate_to_human');
  });

  it('produces independent instances from BUILT_IN_CONTRACTS', () => {
    const contracts = buildContracts(customLimits);
    const planReview = contracts.find((c) => c.id === 'plan_review_loop');

    expect(planReview?.maxIterations).toBe(10);
    expect(PLAN_REVIEW_LOOP.maxIterations).toBe(5);
  });
});
