import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type {
  ArtifactType,
  PolicyContext,
  PolicyDefinition,
  PolicyResult,
} from '@ai-orchestrator/schemas';
const POST_CODE_REVIEW_STATES: ReadonlySet<string> = new Set([
  'CODE_REVIEW',
  'JUDGE_REVIEW',
  'VERIFICATION',
]);

const REVIEW_GATE_CHECKS: readonly {
  readonly configKey: string;
  readonly artifactType: ArtifactType;
  readonly label: string;
}[] = [
  { configKey: 'requireDesignReview', artifactType: 'design_review', label: 'Design' },
  {
    configKey: 'requireAdversarialReview',
    artifactType: 'adversarial_review',
    label: 'Adversarial',
  },
];

/** Evaluates artifacts against quality gate thresholds. */
export class QualityGateEvaluator implements PolicyEvaluator {
  /** @inheritdoc */
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'quality_gate') {
      throw new Error(`Expected quality_gate policy, got ${policy.type}`);
    }
    const { config } = policy;

    const findings = context.findings ?? [];
    const failures: string[] = [];

    const maxHigh = config.maxHighSeverityFindings;
    const maxMedium = config.maxMediumSeverityFindings;

    const highCount = findings.filter((f) => f.severity === 'high' && f.status === 'open').length;
    if (highCount > maxHigh) {
      failures.push(
        `${String(highCount)} high-severity findings exceed limit of ${String(maxHigh)}`,
      );
    }

    const mediumCount = findings.filter(
      (f) => f.severity === 'medium' && f.status === 'open',
    ).length;
    if (mediumCount > maxMedium) {
      failures.push(
        `${String(mediumCount)} medium-severity findings exceed limit of ${String(maxMedium)}`,
      );
    }

    const reviewArtifactsApplicable = POST_CODE_REVIEW_STATES.has(context.currentState);

    if (reviewArtifactsApplicable) {
      const artifactTypes = new Set(context.artifacts.map((a) => a.type));

      for (const gate of REVIEW_GATE_CHECKS) {
        if (
          (config as Record<string, unknown>)[gate.configKey] &&
          !artifactTypes.has(gate.artifactType)
        ) {
          failures.push(`${gate.label} review artifact required but not found`);
        }
      }
    }

    if (failures.length > 0) {
      return {
        policyId: policy.id,
        policyType: policy.type,
        outcome: 'fail',
        reason: failures.join('; '),
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: policy.type,
      outcome: 'pass',
      reason: 'All quality gates passed',
      source: { layer: 'builtin' },
    };
  }
}
