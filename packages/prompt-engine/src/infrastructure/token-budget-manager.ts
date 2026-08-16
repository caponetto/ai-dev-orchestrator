import type { TokenEstimator } from '@ai-orchestrator/ports';
import type {
  ArtifactContextBlock,
  ArtifactPriority,
  TokenBudget,
  TruncationRecord,
} from '@ai-orchestrator/schemas';

import { TokenBudgetExceededError } from '../domain/errors';

interface BudgetResult {
  readonly artifacts: readonly ArtifactContextBlock[];
  readonly truncations: readonly TruncationRecord[];
}

export class TokenBudgetManager {
  private readonly tokenEstimator: TokenEstimator;

  constructor(tokenEstimator: TokenEstimator) {
    this.tokenEstimator = tokenEstimator;
  }

  applyBudget(
    artifacts: readonly ArtifactContextBlock[],
    nonArtifactTokens: number,
    budget: TokenBudget,
  ): BudgetResult {
    const available = budget.maxInputTokens - budget.reservedOutputTokens - nonArtifactTokens;

    if (available <= 0) {
      throw new TokenBudgetExceededError(
        nonArtifactTokens,
        budget.maxInputTokens - budget.reservedOutputTokens,
      );
    }

    const totalArtifactTokens = artifacts.reduce((sum, a) => sum + a.tokenEstimate, 0);

    if (totalArtifactTokens <= available) {
      return { artifacts, truncations: [] };
    }

    return this.truncateArtifacts(artifacts, available, budget.artifactPriority);
  }

  private truncateArtifacts(
    artifacts: readonly ArtifactContextBlock[],
    available: number,
    priorities: readonly ArtifactPriority[],
  ): BudgetResult {
    const priorityMap = new Map(priorities.map((p) => [p.artifactType, p]));

    const sorted = [...artifacts].sort((a, b) => {
      const pa = priorityMap.get(a.ref.type)?.priority ?? 0;
      const pb = priorityMap.get(b.ref.type)?.priority ?? 0;
      return pb - pa;
    });

    const result: ArtifactContextBlock[] = [];
    const truncations: TruncationRecord[] = [];
    let remaining = available;

    for (const artifact of sorted) {
      if (remaining <= 0) {
        truncations.push({
          artifactType: artifact.ref.type,
          originalTokens: artifact.tokenEstimate,
          truncatedTokens: 0,
          strategy: 'omit',
        });
        continue;
      }

      if (artifact.tokenEstimate <= remaining) {
        result.push(artifact);
        remaining -= artifact.tokenEstimate;
        continue;
      }

      const priority = priorityMap.get(artifact.ref.type);
      const strategy = priority?.truncationStrategy ?? 'tail';

      if (strategy === 'omit') {
        truncations.push({
          artifactType: artifact.ref.type,
          originalTokens: artifact.tokenEstimate,
          truncatedTokens: 0,
          strategy: 'omit',
        });
        continue;
      }

      if (strategy === 'summary') {
        const placeholder = `[Content truncated: ${artifact.ref.type} artifact, ${String(artifact.tokenEstimate)} tokens]`;
        const placeholderTokens = this.tokenEstimator.estimate(placeholder);
        if (placeholderTokens <= remaining) {
          result.push({
            ref: artifact.ref,
            content: placeholder,
            tokenEstimate: placeholderTokens,
          });
          remaining -= placeholderTokens;
        }
        truncations.push({
          artifactType: artifact.ref.type,
          originalTokens: artifact.tokenEstimate,
          truncatedTokens:
            placeholderTokens <= remaining + placeholderTokens ? placeholderTokens : 0,
          strategy: 'summary',
        });
        continue;
      }

      const truncatedContent = this.tokenEstimator.truncateToFit(artifact.content, remaining);
      const truncatedTokens = this.tokenEstimator.estimate(truncatedContent);
      result.push({
        ref: artifact.ref,
        content: truncatedContent,
        tokenEstimate: truncatedTokens,
      });
      remaining -= truncatedTokens;
      truncations.push({
        artifactType: artifact.ref.type,
        originalTokens: artifact.tokenEstimate,
        truncatedTokens,
        strategy: 'tail',
      });
    }

    return { artifacts: result, truncations };
  }
}
