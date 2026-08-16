import { describe, expect, it } from 'vitest';

import { loadGovernanceFromYaml, loadPoliciesFromGovernance } from '../governance-file-loader';

describe('governance-file-loader', () => {
  const sampleYaml = `
iteration_limits:
  max_review_iterations: 2
  max_judge_arbitrations: 1
  max_clarification_rounds: 3
  max_acceptance_iterations: 3
quality_gates:
  specification_readiness:
    min_completeness_score: 0.8
  implementation_review:
    max_high_severity_findings: 0
    max_medium_severity_findings: 3
permission_policy:
  default_action: ask_human
  role_trust:
    implementer: high
  rules: []
`;

  it('parses governance YAML into GovernanceConfig', () => {
    const config = loadGovernanceFromYaml(sampleYaml);
    expect(config.iterationLimits.defaults.maxReviewIterations).toBe(2);
    expect(config.qualityGates.specificationReadiness.minCompletenessScore).toBe(0.8);
  });

  it('derives policy definitions from governance config', () => {
    const config = loadGovernanceFromYaml(sampleYaml);
    const policies = loadPoliciesFromGovernance(config);
    expect(policies).toHaveLength(3);
    const iterationPolicy = policies.find((p) => p.type === 'iteration_limit');
    expect(iterationPolicy?.enabled).toBe(true);
  });

  it('loads optional budget and confidence-gate settings and derives their policy', () => {
    const config = loadGovernanceFromYaml(`${sampleYaml}
budget:
  max_tokens_per_run: 50000
confidence_gate:
  model_escalation_threshold: 0.6
  human_escalation_threshold: 0.4
  heuristic_weight: 0.25
  heuristic_signals:
    penalize_hedging_language: true
    penalize_high_retry_count: false
    penalize_unresolved_findings: true
`);

    expect(config.budget).toEqual({ maxTokensPerRun: 50000 });
    expect(config.confidenceGate).toEqual({
      modelEscalationThreshold: 0.6,
      humanEscalationThreshold: 0.4,
      heuristicWeight: 0.25,
      heuristicSignals: {
        penalizeHedgingLanguage: true,
        penalizeHighRetryCount: false,
        penalizeUnresolvedFindings: true,
      },
    });
    expect(loadPoliciesFromGovernance(config)).toContainEqual(
      expect.objectContaining({ id: 'governance:confidence_gate', type: 'confidence_gate' }),
    );
  });

  it('rejects malformed YAML', () => {
    expect(() => loadGovernanceFromYaml('iteration_limits: [')).toThrow();
  });

  it('rejects empty or non-mapping YAML documents', () => {
    expect(() => loadGovernanceFromYaml('')).toThrow('governance.yaml must contain a YAML mapping');
    expect(() => loadGovernanceFromYaml('null')).toThrow(
      'governance.yaml must contain a YAML mapping',
    );
  });
});
