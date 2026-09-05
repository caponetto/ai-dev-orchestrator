import type { PolicyContext, PolicyDefinition, PolicyScope } from '@ai-dev-orchestrator/schemas';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TEST_POLICIES } from '../../../test/fixtures/test-defaults';
import { IterationLimitEvaluator } from '../iteration-limit-evaluator';
import { PolicyResolver } from '../policy-resolver';

function makeIterationLimitPolicy(configOverrides?: {
  maxReviewIterations?: number;
  maxJudgeArbitrations?: number;
  maxClarificationRounds?: number;
  maxAcceptanceIterations?: number;
}): PolicyDefinition {
  return {
    id: 'test:iteration_limit',
    type: 'iteration_limit',
    scope: {},
    config: {
      maxReviewIterations: configOverrides?.maxReviewIterations ?? 2,
      maxJudgeArbitrations: configOverrides?.maxJudgeArbitrations ?? 1,
      maxClarificationRounds: configOverrides?.maxClarificationRounds ?? 3,
      maxAcceptanceIterations: configOverrides?.maxAcceptanceIterations ?? 3,
    },
    enabled: true,
  };
}

const SCOPE: PolicyScope = {};

describe('Policy Engine property-based tests', () => {
  it('policy merge is deterministic (same input produces same output)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 8 }),
        (maxReviewIterations, maxJudgeArbitrations, maxClarificationRounds) => {
          const projectPolicies: PolicyDefinition[] = [
            makeIterationLimitPolicy({
              maxReviewIterations,
              maxJudgeArbitrations,
              maxClarificationRounds,
            }),
          ];

          const resolver1 = new PolicyResolver({
            organization: TEST_POLICIES,
            project: projectPolicies,
          });
          const resolver2 = new PolicyResolver({
            organization: TEST_POLICIES,
            project: projectPolicies,
          });

          const result1 = resolver1.resolve(SCOPE);
          const result2 = resolver2.resolve(SCOPE);

          expect(result1.policies.length).toBe(result2.policies.length);

          for (let i = 0; i < result1.policies.length; i++) {
            expect(result1.policies[i].id).toBe(result2.policies[i].id);
            expect(result1.policies[i].type).toBe(result2.policies[i].type);
            expect(result1.policies[i].enabled).toBe(result2.policies[i].enabled);
            expect(JSON.stringify(result1.policies[i].config)).toBe(
              JSON.stringify(result2.policies[i].config),
            );
          }

          expect(result1.mergeLog.length).toBe(result2.mergeLog.length);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('evaluator produces consistent results for identical inputs', () => {
    const evaluator = new IterationLimitEvaluator();

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.constantFrom('PLANNING', 'WAITING_FOR_HUMAN', 'IMPLEMENTATION', 'REFINEMENT'),
        (iterationCount, maxReviewIterations, maxClarificationRounds, currentState) => {
          const policy = makeIterationLimitPolicy({
            maxReviewIterations,
            maxClarificationRounds,
          });

          const context: PolicyContext = {
            runId: 'run-prop-test',
            currentState,
            artifacts: [],
            iterationCount,
          };

          const result1 = evaluator.evaluate(policy, context);
          const result2 = evaluator.evaluate(policy, context);

          expect(result1.outcome).toBe(result2.outcome);
          expect(result1.reason).toBe(result2.reason);
          expect(result1.policyId).toBe(result2.policyId);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('merge log records one entry per overridden config field', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 8 }),
        (maxReviewIterations, maxJudgeArbitrations, maxClarificationRounds) => {
          const projectPolicies: PolicyDefinition[] = [
            makeIterationLimitPolicy({
              maxReviewIterations,
              maxJudgeArbitrations,
              maxClarificationRounds,
            }),
          ];

          const resolver = new PolicyResolver({
            organization: TEST_POLICIES,
            project: projectPolicies,
          });
          const result = resolver.resolve(SCOPE);

          const iterationLimitEntries = result.mergeLog.filter(
            (entry) => entry.policyId === 'builtin:iteration_limit',
          );

          expect(iterationLimitEntries.length).toBe(4);

          const fields = iterationLimitEntries.map((e) => e.field);
          expect(fields).toContain('maxReviewIterations');
          expect(fields).toContain('maxJudgeArbitrations');
          expect(fields).toContain('maxClarificationRounds');
          expect(fields).toContain('maxAcceptanceIterations');
        },
      ),
      { numRuns: 200 },
    );
  });
});
