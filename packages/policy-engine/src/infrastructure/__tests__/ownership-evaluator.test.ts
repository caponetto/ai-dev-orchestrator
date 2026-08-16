import type {
  ArtifactRef,
  ArtifactType,
  PolicyContext,
  PolicyDefinition,
} from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { OwnershipEvaluator } from '../ownership-evaluator';

const POLICY = {
  id: 'builtin:ownership',
  type: 'ownership' as const,
  scope: {},
  config: {
    ownershipMap: {
      implementer: ['implementation', 'test_plan'],
      reviewer: ['static_review', 'security_review'],
    },
    strict: false,
  },
  enabled: true,
} satisfies PolicyDefinition;

function makeArtifact(type: ArtifactType): ArtifactRef {
  return {
    type,
    name: type,
    version: 1,
    checksum: 'abc',
  };
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    runId: 'run-001',
    currentState: 'IMPLEMENTATION',
    artifacts: [],
    ...overrides,
  };
}

describe('OwnershipEvaluator', () => {
  const evaluator = new OwnershipEvaluator();

  it('passes when role owns all artifact types', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        role: 'implementer',
        artifacts: [makeArtifact('implementation'), makeArtifact('test_plan')],
      }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.policyId).toBe('builtin:ownership');
    expect(result.policyType).toBe('ownership');
    expect(result.source.layer).toBe('builtin');
  });

  it('fails when role lacks ownership of an artifact type', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        role: 'implementer',
        artifacts: [makeArtifact('implementation'), makeArtifact('security_review')],
      }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('security_review');
  });

  it('passes when no role is specified in non-strict mode', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({ artifacts: [makeArtifact('implementation')] }),
    );
    expect(result.outcome).toBe('pass');
    expect(result.reason).toContain('skipped');
  });

  it('fails when no role is specified in strict mode', () => {
    const strictPolicy: PolicyDefinition = {
      ...POLICY,
      config: { ...POLICY.config, strict: true },
    };
    const result = evaluator.evaluate(
      strictPolicy,
      makeContext({ artifacts: [makeArtifact('implementation')] }),
    );
    expect(result.outcome).toBe('fail');
    expect(result.reason).toContain('strict ownership requires a role');
  });

  it('passes when role has no artifacts to check', () => {
    const result = evaluator.evaluate(POLICY, makeContext({ role: 'implementer', artifacts: [] }));
    expect(result.outcome).toBe('pass');
  });

  it('passes for reviewer role with review artifacts', () => {
    const result = evaluator.evaluate(
      POLICY,
      makeContext({
        role: 'reviewer',
        artifacts: [makeArtifact('static_review'), makeArtifact('security_review')],
      }),
    );
    expect(result.outcome).toBe('pass');
  });
});
