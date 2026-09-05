import { REVIEW_ARTIFACT_TYPES, safeJsonParse } from '@ai-dev-orchestrator/artifacts';
import type { ArtifactStore, IterationContractRegistry, Logger } from '@ai-dev-orchestrator/ports';
import { noopLogger } from '@ai-dev-orchestrator/ports';
import type { ActionResult, ArtifactType, TransitionTrigger } from '@ai-dev-orchestrator/schemas';
import { FRONTMATTER_REGEX } from '@ai-dev-orchestrator/utils';
import { z } from 'zod';

const FAIL_SAFE_REJECTION_ERROR_TYPES: ReadonlySet<NonNullable<ActionResult['errorType']>> =
  new Set(['invalid_output', 'schema_violation']);

/**
 * Determines the transition trigger for a state by inspecting action results
 * and, for review states, reading the artifact content to check approval status.
 */
export class ReviewResultInterpreter {
  private readonly logger: Logger;

  constructor(
    private readonly artifactStore: ArtifactStore,
    private readonly contractRegistry: IterationContractRegistry,
    logger?: Logger,
  ) {
    this.logger = logger ?? noopLogger;
  }

  async interpret(
    actionResults: readonly ActionResult[],
    stateId: string,
    stateType: string,
  ): Promise<TransitionTrigger> {
    if (actionResults.some((r) => r.sessionOutcome === 'awaiting_human')) {
      return 'human_input';
    }

    const normalized = this.normalizeResults(actionResults);

    if (stateType === 'review') {
      if (this.hasHardProcessFailure(normalized)) {
        return 'failure';
      }
      return this.interpretReview(normalized, stateId);
    }

    if (stateType === 'judge') {
      if (this.hasHardProcessFailure(normalized)) {
        return 'failure';
      }
      return this.interpretJudge(normalized, stateId);
    }

    if (normalized.some((r) => !r.success)) {
      return 'failure';
    }

    return 'completion';
  }

  private hasHardProcessFailure(actionResults: readonly ActionResult[]): boolean {
    const hardFailures = actionResults.filter(
      (result) => !result.success && !this.isFailSafeSemanticFailure(result),
    );
    if (hardFailures.length === 0) {
      return false;
    }
    if (actionResults.some((r) => r.success)) {
      for (const f of hardFailures) {
        this.logger.warn(
          `[ReviewInterpreter] worker failed but continuing with partial results: ${f.error ?? 'unknown error'}`,
        );
      }
      return false;
    }
    return true;
  }

  private isFailSafeSemanticFailure(result: ActionResult): boolean {
    return (
      !result.success &&
      result.errorType !== undefined &&
      FAIL_SAFE_REJECTION_ERROR_TYPES.has(result.errorType)
    );
  }

  private normalizeResults(actionResults: readonly ActionResult[]): readonly ActionResult[] {
    const expanded: ActionResult[] = [];
    for (const result of actionResults) {
      if (result.workerResults && result.workerResults.length > 0) {
        for (const wr of result.workerResults) {
          expanded.push({
            action: result.action,
            success: wr.success,
            error: wr.error,
            errorType: wr.errorType,
            artifactRef: wr.artifactRef,
          });
        }
      } else {
        expanded.push(result);
      }
    }
    return expanded;
  }

  private async interpretReview(
    actionResults: readonly ActionResult[],
    stateId: string,
  ): Promise<TransitionTrigger> {
    this.logger.debug(
      `[ReviewInterpreter] state=${stateId}, results=${String(actionResults.length)}`,
    );

    if (this.hasIncompleteReviewSet(actionResults)) {
      this.logger.debug(`[ReviewInterpreter] incomplete review set — trigger=failure`);
      return 'failure';
    }

    const allApproved = await this.checkArtifactApproval(actionResults);
    this.logger.debug(`[ReviewInterpreter] artifactApproval=${String(allApproved)}`);
    if (allApproved) {
      return 'review_approved';
    }

    const contract = this.contractRegistry.getContractForState(stateId);
    if (contract) {
      const iterState = this.contractRegistry.getIterationState(contract.id);
      if (iterState.currentIteration >= contract.maxIterations) {
        this.logger.debug(`[ReviewInterpreter] trigger=iteration_exhausted`);
        return 'iteration_exhausted';
      }
    }

    this.logger.debug(`[ReviewInterpreter] trigger=review_rejected`);
    return 'review_rejected';
  }

  private hasIncompleteReviewSet(actionResults: readonly ActionResult[]): boolean {
    const parallelAction = actionResults.find((r) => r.action.type === 'dispatch_parallel_workers');
    if (!parallelAction?.workerResults) {
      return false;
    }

    const expectedCount = parallelAction.workerResults.length;
    const reviewArtifactCount = parallelAction.workerResults.filter(
      (wr) => wr.artifactRef !== undefined && REVIEW_ARTIFACT_TYPES.has(wr.artifactRef.type),
    ).length;

    if (reviewArtifactCount === 0 && expectedCount > 0) {
      this.logger.debug(
        `[ReviewInterpreter] no review artifacts produced from ${String(expectedCount)} workers`,
      );
      return true;
    }

    return false;
  }

  private async interpretJudge(
    actionResults: readonly ActionResult[],
    stateId: string,
  ): Promise<TransitionTrigger> {
    for (const result of actionResults) {
      if (result.artifactRef?.type === 'judge_decision') {
        const approved = await this.readApprovalField(
          result.artifactRef.type,
          result.artifactRef.name,
        );
        if (approved) {
          return 'judge_approved';
        }
        return this.judgeRejectionTrigger(stateId);
      }
    }

    return this.judgeRejectionTrigger(stateId);
  }

  private judgeRejectionTrigger(stateId: string): TransitionTrigger {
    const contract = this.contractRegistry.getContractForState(stateId);
    if (contract) {
      const iterState = this.contractRegistry.getIterationState(contract.id);
      if (iterState.judgeArbitrations >= contract.maxJudgeArbitrations) {
        return 'escalation';
      }
    }
    return 'judge_rejected';
  }

  private async checkArtifactApproval(actionResults: readonly ActionResult[]): Promise<boolean> {
    let reviewArtifactCount = 0;
    for (const result of actionResults) {
      if (this.isFailSafeSemanticFailure(result)) {
        const hasReviewArtifact =
          result.artifactRef !== undefined && REVIEW_ARTIFACT_TYPES.has(result.artifactRef.type);
        if (!hasReviewArtifact) {
          this.logger.debug(
            '[ReviewInterpreter] semantic failure without review artifact — treating as not approved',
          );
          return false;
        }
      }

      if (!result.artifactRef) {
        continue;
      }
      if (!REVIEW_ARTIFACT_TYPES.has(result.artifactRef.type)) {
        continue;
      }

      reviewArtifactCount += 1;
      this.logger.debug(
        `[ReviewInterpreter] checking artifact: type=${result.artifactRef.type}, name=${result.artifactRef.name}`,
      );
      const approved = await this.readApprovalField(
        result.artifactRef.type,
        result.artifactRef.name,
      );
      this.logger.debug(`[ReviewInterpreter] artifact approved=${String(approved)}`);
      if (!approved) {
        return false;
      }
    }
    this.logger.debug(`[ReviewInterpreter] reviewArtifactCount=${String(reviewArtifactCount)}`);
    if (reviewArtifactCount === 0) {
      return false;
    }

    const parallelWorkers = actionResults.filter(
      (r) => r.action.type === 'dispatch_parallel_workers',
    );
    const eligibleWorkerCount = parallelWorkers.filter(
      (r) => r.success || this.isFailSafeSemanticFailure(r),
    ).length;
    if (eligibleWorkerCount > 0 && reviewArtifactCount < eligibleWorkerCount) {
      this.logger.debug(
        `[ReviewInterpreter] only ${String(reviewArtifactCount)} of ${String(eligibleWorkerCount)} ` +
          `eligible parallel workers produced review artifacts — not approved`,
      );
      return false;
    }

    return true;
  }

  private async readApprovalField(type: ArtifactType, name: string): Promise<boolean> {
    try {
      const artifact = await this.artifactStore.getLatest(type, name);
      if (!artifact) {
        return false;
      }

      const jsonApproved = this.tryJsonApproval(artifact.content);
      if (jsonApproved !== null) {
        return jsonApproved;
      }

      const frontmatterMatch = FRONTMATTER_REGEX.exec(artifact.content);
      if (frontmatterMatch?.[1]) {
        const approvedMatch = /^approved:\s*(true|false)/m.exec(frontmatterMatch[1]);
        if (approvedMatch) {
          return approvedMatch[1] === 'true';
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private tryJsonApproval(content: string): boolean | null {
    const result = safeJsonParse(content, z.object({ approved: z.boolean() }).loose());
    return result.success ? result.data.approved : null;
  }
}
