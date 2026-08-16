import type { PolicyEvaluator } from '@ai-orchestrator/ports';
import type {
  ConfidenceReport,
  PolicyConfidenceGateConfig,
  PolicyContext,
  PolicyDefinition,
  PolicyResult,
} from '@ai-orchestrator/schemas';

const RETRY_PENALTY = 0.15;
const MAX_RETRY_PENALTY = 0.45;
const HIGH_FINDING_PENALTY = 0.2;
const TOKEN_OVERUSE_PENALTY = 0.15;
const TOKEN_OVERUSE_RATIO = 0.8;
const DIVERGENCE_THRESHOLD = 0.3;

export class ConfidenceEvaluator implements PolicyEvaluator {
  evaluate(policy: PolicyDefinition, context: PolicyContext): PolicyResult {
    if (policy.type !== 'confidence_gate') {
      throw new Error(`ConfidenceEvaluator received policy type '${policy.type}'`);
    }

    const config = policy.config;
    const report = context.metadata?.confidenceReport as ConfidenceReport | undefined;
    const heuristicScore = this.computeHeuristicScore(context, config);

    let finalScore: number;
    let reason: string;

    if (report) {
      const agentScore = report.score;
      const divergence = Math.abs(agentScore - heuristicScore);

      if (divergence > DIVERGENCE_THRESHOLD) {
        finalScore = Math.min(agentScore, heuristicScore);
        reason = `Agent (${agentScore.toFixed(2)}) and heuristic (${heuristicScore.toFixed(2)}) scores diverge by ${divergence.toFixed(2)} — using lower score`;
      } else {
        finalScore =
          agentScore * (1 - config.heuristicWeight) + heuristicScore * config.heuristicWeight;
        reason = `Blended score: agent=${agentScore.toFixed(2)}, heuristic=${heuristicScore.toFixed(2)}, final=${finalScore.toFixed(2)}`;
      }
    } else {
      finalScore = heuristicScore;
      reason = `No agent confidence report — heuristic-only score: ${heuristicScore.toFixed(2)}`;
    }

    if (finalScore >= config.modelEscalationThreshold) {
      return {
        policyId: policy.id,
        policyType: 'confidence_gate',
        outcome: 'pass',
        reason,
        source: { layer: 'builtin' },
      };
    }

    return {
      policyId: policy.id,
      policyType: 'confidence_gate',
      outcome: 'fail',
      reason,
      source: { layer: 'builtin' },
      escalationTrigger: 'confidence_too_low',
    };
  }

  private computeHeuristicScore(
    context: PolicyContext,
    config: PolicyConfidenceGateConfig,
  ): number {
    let score = 1.0;

    if (config.heuristicSignals.penalizeHighRetryCount) {
      const retryCount = context.metadata?.retryCount ?? 0;
      if (retryCount > 0) {
        score -= Math.min(RETRY_PENALTY * retryCount, MAX_RETRY_PENALTY);
      }
    }

    if (config.heuristicSignals.penalizeUnresolvedFindings && context.findings) {
      const highSeverityOpen = context.findings.filter(
        (f) => f.severity === 'high' && f.status === 'open',
      );
      score -= HIGH_FINDING_PENALTY * highSeverityOpen.length;
    }

    if (context.tokenUsage) {
      const budgetRatio = context.tokenUsage.totalTokens / (context.tokenUsage.totalTokens + 1);
      if (budgetRatio > TOKEN_OVERUSE_RATIO) {
        score -= TOKEN_OVERUSE_PENALTY;
      }
    }

    return Math.max(0, score);
  }
}
