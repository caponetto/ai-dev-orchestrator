/** Evaluates findings against quality gate thresholds. */
import type { FindingSummary, PolicyEvaluation } from '@ai-dev-orchestrator/schemas';
export class QualityGateChecker {
  /** Evaluate findings against severity thresholds. */
  evaluate(
    findings: readonly FindingSummary[],
    maxHighSeverity: number,
    maxMediumSeverity: number,
  ): PolicyEvaluation {
    const openFindings = findings.filter((f) => f.status === 'open');
    const highCount = openFindings.filter((f) => f.severity === 'high').length;
    const mediumCount = openFindings.filter((f) => f.severity === 'medium').length;

    const failures: string[] = [];

    if (highCount > maxHighSeverity) {
      failures.push(`${String(highCount)} high-severity findings (max ${String(maxHighSeverity)})`);
    }
    if (mediumCount > maxMediumSeverity) {
      failures.push(
        `${String(mediumCount)} medium-severity findings (max ${String(maxMediumSeverity)})`,
      );
    }

    if (failures.length > 0) {
      return {
        policy: 'quality_gate',
        evaluated: true,
        result: 'fail',
        detail: `Quality gate failed: ${failures.join('; ')}`,
      };
    }

    return {
      policy: 'quality_gate',
      evaluated: true,
      result: 'pass',
      detail: `Quality gate passed: ${String(openFindings.length)} open findings within thresholds`,
    };
  }
}
