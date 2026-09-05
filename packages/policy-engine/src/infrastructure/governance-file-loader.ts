import type { GovernanceConfig, PolicyDefinition } from '@ai-dev-orchestrator/schemas';
import {
  isObject,
  requireNumber,
  requireObject,
  snakeToCamelDeep,
} from '@ai-dev-orchestrator/utils';
import { parse as parseYaml, YAMLParseError } from 'yaml';

/** Parses governance.yaml content into a typed governance configuration. */
export function loadGovernanceFromYaml(yamlContent: string): GovernanceConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (error: unknown) {
    const message =
      error instanceof YAMLParseError ? error.message : `Invalid YAML: ${String(error)}`;
    throw new Error(message);
  }

  const raw = snakeToCamelDeep(parsed);
  if (!isObject(raw)) {
    throw new Error('governance.yaml must contain a YAML mapping');
  }
  const iterationLimits = requireObject(raw, 'iterationLimits');
  const qualityGates = requireObject(raw, 'qualityGates');

  const specificationReadiness = requireObject(qualityGates, 'specificationReadiness');
  const implementationReview = requireObject(qualityGates, 'implementationReview');

  let config: GovernanceConfig = {
    iterationLimits: {
      defaults: {
        maxReviewIterations: requireNumber(iterationLimits, 'maxReviewIterations'),
        maxJudgeArbitrations: requireNumber(iterationLimits, 'maxJudgeArbitrations'),
        maxClarificationRounds: requireNumber(iterationLimits, 'maxClarificationRounds'),
        maxAcceptanceIterations: requireNumber(iterationLimits, 'maxAcceptanceIterations'),
      },
    },
    qualityGates: {
      specificationReadiness: {
        minCompletenessScore: requireNumber(specificationReadiness, 'minCompletenessScore'),
      },
      implementationReview: {
        maxHighSeverityFindings: requireNumber(implementationReview, 'maxHighSeverityFindings'),
        maxMediumSeverityFindings: requireNumber(implementationReview, 'maxMediumSeverityFindings'),
      },
    },
  };

  const budget = raw['budget'];
  if (isObject(budget)) {
    const maxTokensPerRun = budget['maxTokensPerRun'];
    if (typeof maxTokensPerRun === 'number') {
      config = { ...config, budget: { maxTokensPerRun } };
    }
  }

  const confidenceGate = raw['confidenceGate'];
  if (isObject(confidenceGate)) {
    const modelEscalationThreshold = confidenceGate['modelEscalationThreshold'];
    const humanEscalationThreshold = confidenceGate['humanEscalationThreshold'];
    const heuristicWeight = confidenceGate['heuristicWeight'];
    const signals = confidenceGate['heuristicSignals'];
    if (
      typeof modelEscalationThreshold === 'number' &&
      typeof humanEscalationThreshold === 'number' &&
      typeof heuristicWeight === 'number' &&
      isObject(signals)
    ) {
      config = {
        ...config,
        confidenceGate: {
          modelEscalationThreshold,
          humanEscalationThreshold,
          heuristicWeight,
          heuristicSignals: {
            penalizeHedgingLanguage: signals['penalizeHedgingLanguage'] === true,
            penalizeHighRetryCount: signals['penalizeHighRetryCount'] === true,
            penalizeUnresolvedFindings: signals['penalizeUnresolvedFindings'] === true,
          },
        },
      };
    }
  }

  return config;
}

/** Derives policy definitions from a parsed governance configuration. */
export function loadPoliciesFromGovernance(config: GovernanceConfig): PolicyDefinition[] {
  const { iterationLimits, qualityGates } = config;

  const policies: PolicyDefinition[] = [
    {
      id: 'governance:iteration_limit',
      type: 'iteration_limit',
      scope: {},
      config: {
        maxReviewIterations: iterationLimits.defaults.maxReviewIterations,
        maxJudgeArbitrations: iterationLimits.defaults.maxJudgeArbitrations,
        maxClarificationRounds: iterationLimits.defaults.maxClarificationRounds,
        maxAcceptanceIterations: iterationLimits.defaults.maxAcceptanceIterations,
      },
      enabled: true,
    },
    {
      id: 'governance:quality_gate',
      type: 'quality_gate',
      scope: {},
      config: {
        maxHighSeverityFindings: qualityGates.implementationReview.maxHighSeverityFindings,
        maxMediumSeverityFindings: qualityGates.implementationReview.maxMediumSeverityFindings,
      },
      enabled: true,
    },
    {
      id: 'governance:specification_readiness',
      type: 'specification_readiness',
      scope: {},
      config: {
        minCompletenessScore: qualityGates.specificationReadiness.minCompletenessScore,
      },
      enabled: true,
    },
  ];

  if (config.confidenceGate) {
    policies.push({
      id: 'governance:confidence_gate',
      type: 'confidence_gate',
      scope: {},
      config: config.confidenceGate,
      enabled: true,
    });
  }

  return policies;
}
