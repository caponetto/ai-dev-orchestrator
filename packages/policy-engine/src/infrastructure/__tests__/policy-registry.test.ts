import type { PolicyEvaluator } from '@ai-dev-orchestrator/ports';
import type { PolicyType } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { UnknownPolicyTypeError } from '../../domain/errors';
import { DefaultPolicyRegistry } from '../policy-registry';

describe('DefaultPolicyRegistry', () => {
  it('registers all built-in evaluators on construction', () => {
    const registry = new DefaultPolicyRegistry();
    const types = registry.listTypes();
    expect(types).toHaveLength(10);
    expect(types.map((t) => t.type)).toEqual(
      expect.arrayContaining([
        'iteration_limit',
        'quality_gate',
        'specification_readiness',
        'stage_skip',
        'retry_limit',
        'token_budget',
        'model_constraint',
        'ownership',
        'confidence_gate',
        'custom',
      ]),
    );
  });

  it('all built-in types are marked as builtIn', () => {
    const registry = new DefaultPolicyRegistry();
    for (const info of registry.listTypes()) {
      expect(info.builtIn).toBe(true);
    }
  });

  it('returns evaluator for registered type', () => {
    const registry = new DefaultPolicyRegistry();
    const evaluator = registry.getEvaluator('iteration_limit');
    expect(evaluator).toBeDefined();
    expect(typeof evaluator.evaluate).toBe('function');
  });

  it('throws UnknownPolicyTypeError for unregistered type', () => {
    const registry = new DefaultPolicyRegistry();
    expect(() => registry.getEvaluator('nonexistent' as PolicyType)).toThrow(
      UnknownPolicyTypeError,
    );
  });

  it('allows registering custom evaluator', () => {
    const registry = new DefaultPolicyRegistry();
    const customEvaluator: PolicyEvaluator = {
      evaluate: () => ({
        policyId: 'custom:test',
        policyType: 'custom',
        outcome: 'pass',
        reason: 'custom pass',
        source: { layer: 'project' },
      }),
    };

    registry.registerType('custom', customEvaluator);
    const evaluator = registry.getEvaluator('custom');
    expect(evaluator).toBe(customEvaluator);
  });

  it('allows overriding a built-in evaluator with registerType', () => {
    const registry = new DefaultPolicyRegistry();
    const customEvaluator: PolicyEvaluator = {
      evaluate: () => ({
        policyId: 'custom:test',
        policyType: 'custom',
        outcome: 'pass',
        reason: 'custom pass',
        source: { layer: 'project' },
      }),
    };

    registry.registerType('custom', customEvaluator);
    const types = registry.listTypes();
    expect(types).toHaveLength(10);
    const evaluator = registry.getEvaluator('custom');
    expect(evaluator).toBe(customEvaluator);
  });
});
