import type { PolicyDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { TEST_POLICIES } from '../../../test/fixtures/test-defaults';
import { PolicyResolver } from '../policy-resolver';

describe('PolicyResolver', () => {
  it('resolves injected policies when no project overrides', () => {
    const resolver = new PolicyResolver(TEST_POLICIES);
    const result = resolver.resolve({});
    expect(result.policies).toHaveLength(3);
    expect(result.policies.map((p) => p.type)).toEqual([
      'iteration_limit',
      'quality_gate',
      'specification_readiness',
    ]);
  });

  it('merges project overrides into injected policies', () => {
    const projectPolicy: PolicyDefinition = {
      id: 'project:iteration_limit',
      type: 'iteration_limit',
      scope: {},
      config: {
        maxReviewIterations: 5,
        maxJudgeArbitrations: 1,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 3,
      },
      enabled: true,
    };
    const resolver = new PolicyResolver({
      project: [...TEST_POLICIES, projectPolicy],
    });
    const result = resolver.resolve({});

    const iterationPolicy = result.policies.find((p) => p.type === 'iteration_limit');
    expect(iterationPolicy).toBeDefined();
    expect((iterationPolicy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(5);
  });

  it('records merge log for overridden fields', () => {
    const projectPolicy: PolicyDefinition = {
      id: 'project:iteration_limit',
      type: 'iteration_limit',
      scope: {},
      config: {
        maxReviewIterations: 5,
        maxJudgeArbitrations: 1,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 3,
      },
      enabled: true,
    };
    const resolver = new PolicyResolver({
      organization: TEST_POLICIES,
      project: [projectPolicy],
    });
    const result = resolver.resolve({});

    expect(result.mergeLog.length).toBeGreaterThan(0);
    const entry = result.mergeLog.find((e) => e.field === 'maxReviewIterations');
    expect(entry).toBeDefined();
    expect(entry?.fromValue).toBe(2);
    expect(entry?.toValue).toBe(5);
    expect(entry?.fromLayer).toBe('organization');
    expect(entry?.toLayer).toBe('project');
  });

  it('excludes disabled policies', () => {
    const disabledPolicy: PolicyDefinition = {
      id: 'project:quality_gate',
      type: 'quality_gate',
      scope: {},
      config: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
      enabled: false,
    };
    const resolver = new PolicyResolver({
      organization: TEST_POLICIES,
      project: [disabledPolicy],
    });
    const result = resolver.resolve({});

    const qualityGate = result.policies.find((p) => p.type === 'quality_gate');
    expect(qualityGate).toBeUndefined();
  });

  it('adds new project-only policies', () => {
    const customPolicy: PolicyDefinition = {
      id: 'project:token_budget',
      type: 'token_budget',
      scope: {},
      config: { maxTokens: 100000 },
      enabled: true,
    };
    const resolver = new PolicyResolver({
      organization: TEST_POLICIES,
      project: [customPolicy],
    });
    const result = resolver.resolve({});

    expect(result.policies).toHaveLength(4);
    const tokenPolicy = result.policies.find((p) => p.type === 'token_budget');
    expect(tokenPolicy).toBeDefined();
    expect(tokenPolicy?.config).toEqual({ maxTokens: 100000 });
  });

  it('traces source for injected policy', () => {
    const resolver = new PolicyResolver({
      organization: TEST_POLICIES,
    });
    resolver.resolve({});
    const source = resolver.traceSource('builtin:iteration_limit', 'maxReviewIterations');
    expect(source).toEqual({ layer: 'organization' });
  });

  it('traces source for overridden policy', () => {
    const projectPolicy: PolicyDefinition = {
      id: 'project:iteration_limit',
      type: 'iteration_limit',
      scope: {},
      config: { maxReviewIterations: 5 },
      enabled: true,
    };
    const resolver = new PolicyResolver({
      organization: TEST_POLICIES,
      project: [projectPolicy],
    });
    resolver.resolve({});
    const source = resolver.traceSource('builtin:iteration_limit', 'maxReviewIterations');
    expect(source).toEqual({ layer: 'project' });
  });

  it('returns null for unknown policy', () => {
    const resolver = new PolicyResolver(TEST_POLICIES);
    resolver.resolve({});
    const source = resolver.traceSource('unknown:policy', 'field');
    expect(source).toBeNull();
  });

  describe('five-layer hierarchy', () => {
    it('organization layer provides baseline', () => {
      const resolver = new PolicyResolver({
        organization: [
          {
            id: 'org:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 4,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
      });
      const result = resolver.resolve({});
      const policy = result.policies.find((p) => p.type === 'iteration_limit');
      expect((policy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(4);
      expect(result.sources.get('org:iteration_limit')?.layer).toBe('organization');
    });

    it('project layer overrides organization', () => {
      const resolver = new PolicyResolver({
        organization: [
          {
            id: 'org:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 4,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        project: [
          {
            id: 'proj:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 6,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
      });
      const result = resolver.resolve({});
      const policy = result.policies.find((p) => p.type === 'iteration_limit');
      expect((policy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(6);
      expect(result.sources.get('org:iteration_limit')?.layer).toBe('project');
    });

    it('workflow variant overrides project', () => {
      const resolver = new PolicyResolver({
        project: [
          {
            id: 'proj:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 6,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        workflowVariant: [
          {
            id: 'wf:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 1,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
      });
      const result = resolver.resolve({});
      const policy = result.policies.find((p) => p.type === 'iteration_limit');
      expect((policy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(1);
      expect(result.sources.get('proj:iteration_limit')?.layer).toBe('workflow_variant');
    });

    it('override layer wins over all others', () => {
      const resolver = new PolicyResolver({
        organization: [
          {
            id: 'org:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 4,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        project: [
          {
            id: 'proj:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 6,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        workflowVariant: [
          {
            id: 'wf:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 3,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        overrides: [
          {
            id: 'override:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 10,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
      });
      const result = resolver.resolve({});
      const policy = result.policies.find((p) => p.type === 'iteration_limit');
      expect((policy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(10);
      expect(result.sources.get('org:iteration_limit')?.layer).toBe('role');
    });

    it('merge log records correct layer transitions', () => {
      const resolver = new PolicyResolver({
        organization: [
          {
            id: 'org:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 4,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
        project: [
          {
            id: 'proj:iteration_limit',
            type: 'iteration_limit',
            scope: {},
            config: {
              maxReviewIterations: 6,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
              maxAcceptanceIterations: 3,
            },
            enabled: true,
          },
        ],
      });
      const result = resolver.resolve({});

      const orgEntry = result.mergeLog.find(
        (e) => e.fromLayer === 'organization' && e.toLayer === 'project',
      );
      expect(orgEntry).toBeDefined();
      expect(orgEntry?.toValue).toBe(6);
    });

    it('disabled policies are filtered at each layer', () => {
      const resolver = new PolicyResolver({
        organization: [
          {
            id: 'org:quality_gate',
            type: 'quality_gate',
            scope: {},
            config: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 0 },
            enabled: false,
          },
        ],
      });
      const result = resolver.resolve({});
      const qualityGate = result.policies.find((p) => p.type === 'quality_gate');
      expect(qualityGate).toBeUndefined();
    });

    it('accepts plain array for backward compatibility', () => {
      const projectPolicies: PolicyDefinition[] = [
        {
          id: 'project:iteration_limit',
          type: 'iteration_limit',
          scope: {},
          config: {
            maxReviewIterations: 5,
            maxJudgeArbitrations: 1,
            maxClarificationRounds: 3,
            maxAcceptanceIterations: 3,
          },
          enabled: true,
        },
      ];
      const resolver = new PolicyResolver(projectPolicies);
      const result = resolver.resolve({});
      const policy = result.policies.find((p) => p.type === 'iteration_limit');
      expect((policy?.config as Record<string, unknown>)['maxReviewIterations']).toBe(5);
    });
  });
});
