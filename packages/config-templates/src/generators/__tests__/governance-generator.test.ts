import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateGovernanceYaml } from '../governance-generator';

describe('governance-generator', () => {
  it('returns a non-empty string', () => {
    const yaml = generateGovernanceYaml();
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('parses as valid YAML', () => {
    const yaml = generateGovernanceYaml();
    expect(() => parseYaml(yaml) as unknown).not.toThrow();
  });

  it('contains all top-level governance sections', () => {
    const parsed = parseYaml(generateGovernanceYaml()) as Record<string, unknown>;
    expect(parsed).toHaveProperty('iteration_limits');
    expect(parsed).toHaveProperty('quality_gates');
    expect(parsed).toHaveProperty('budget');
    expect(parsed).toHaveProperty('permission_policy');
  });

  describe('iteration_limits', () => {
    it('has all required limit fields', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        iteration_limits: Record<string, number>;
      };
      const limits = parsed.iteration_limits;
      expect(limits).toHaveProperty('max_review_iterations');
      expect(limits).toHaveProperty('max_judge_arbitrations');
      expect(limits).toHaveProperty('max_clarification_rounds');
    });

    it('has positive integer values for all limits', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        iteration_limits: Record<string, number>;
      };
      for (const value of Object.values(parsed.iteration_limits)) {
        expect(value).toBeGreaterThan(0);
        expect(Number.isInteger(value)).toBe(true);
      }
    });
  });

  describe('quality_gates', () => {
    it('has specification_readiness with min_completeness_score between 0 and 1', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        quality_gates: { specification_readiness: { min_completeness_score: number } };
      };
      const score = parsed.quality_gates.specification_readiness.min_completeness_score;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('has implementation_review with non-negative thresholds', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        quality_gates: {
          implementation_review: {
            max_high_severity_findings: number;
            max_medium_severity_findings: number;
          };
        };
      };
      const review = parsed.quality_gates.implementation_review;
      expect(review.max_high_severity_findings).toBeGreaterThanOrEqual(0);
      expect(review.max_medium_severity_findings).toBeGreaterThanOrEqual(0);
    });
  });

  describe('permission_policy', () => {
    it('has a valid default_action', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        permission_policy: { default_action: string };
      };
      expect(['grant', 'deny', 'ask_human']).toContain(parsed.permission_policy.default_action);
    });

    it('has role_trust as an object', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        permission_policy: { role_trust: Record<string, string> };
      };
      expect(typeof parsed.permission_policy.role_trust).toBe('object');
    });

    it('has rules as an array', () => {
      const parsed = parseYaml(generateGovernanceYaml()) as {
        permission_policy: { rules: unknown[] };
      };
      expect(Array.isArray(parsed.permission_policy.rules)).toBe(true);
    });
  });

  it('returns identical content on consecutive calls', () => {
    expect(generateGovernanceYaml()).toBe(generateGovernanceYaml());
  });
});
