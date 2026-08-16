import type { GovernanceEngine, Logger } from '@ai-orchestrator/ports';
import { createRunId, noopLogger } from '@ai-orchestrator/ports';
import type {
  EvaluatedTransition,
  StateDefinition,
  TransitionContext,
  TransitionDefinition,
  TransitionTrigger,
} from '@ai-orchestrator/schemas';

import type { GuardChecker } from './guard-checker';

/** Evaluates outgoing transitions from a state to find the first matching one. */
export class TransitionEvaluator {
  private readonly guardChecker: GuardChecker;
  private readonly governanceEngine: GovernanceEngine;
  private readonly logger: Logger;

  constructor(guardChecker: GuardChecker, governanceEngine: GovernanceEngine, logger?: Logger) {
    this.guardChecker = guardChecker;
    this.governanceEngine = governanceEngine;
    this.logger = logger ?? noopLogger;
  }

  /** Find the first transition that matches the trigger and passes all guards. */
  async evaluate(
    state: StateDefinition,
    trigger: TransitionTrigger,
    context: TransitionContext,
  ): Promise<EvaluatedTransition | null> {
    const candidates = state.transitions
      .filter((t) => t.trigger === trigger)
      .sort((a: TransitionDefinition, b: TransitionDefinition) => a.priority - b.priority);

    this.logger.debug(
      `[TransitionEvaluator] trigger='${trigger}', candidates=${String(candidates.length)}/${String(state.transitions.length)}`,
    );

    for (const definition of candidates) {
      const guardsResult = await this.guardChecker.evaluateAll(definition.guards, context);
      const allPassed = guardsResult.every((r) => r.passed);

      if (!allPassed) {
        const failed = guardsResult
          .filter((r) => !r.passed)
          .map((r) => r.guard.type)
          .join(', ');
        this.logger.debug(
          `[TransitionEvaluator] → ${definition.target}: guards FAILED (${failed})`,
        );
        continue;
      }

      if (definition.governanceRequired) {
        const decision = this.governanceEngine.evaluateTransition({
          runId: createRunId(context.runId),
          from: context.stateHistory[context.stateHistory.length - 1] ?? '',
          to: definition.target,
          artifacts: context.artifactRefs ?? [],
          iterationCount: context.currentIteration,
          tokenUsage: context.tokenUsage,
        });

        this.logger.debug(
          `[TransitionEvaluator] → ${definition.target}: governance=${JSON.stringify(decision).slice(0, 200)}`,
        );

        if ('escalate' in decision) {
          return {
            definition,
            guardsResult,
            governanceDecision: 'escalated',
          };
        }

        if (!decision.allowed) {
          continue;
        }
      }

      this.logger.debug(`[TransitionEvaluator] → ${definition.target}: MATCHED`);
      return { definition, guardsResult, governanceDecision: 'allowed' };
    }

    this.logger.debug('[TransitionEvaluator] No transition matched');
    return null;
  }
}
