import type { ArtifactStore, PromptEngine } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef, RenderedPrompt, WorkerContext } from '@ai-dev-orchestrator/schemas';

import { InvalidOutputError, OutputOwnershipError } from '../../domain/runner-system/errors';

interface ProcessResult {
  readonly outputArtifacts: readonly ArtifactRef[];
  readonly repairAttempts: number;
}

/** Processes worker output: validates against schema and stores as artifact. */
export class OutputProcessor {
  constructor(
    private readonly promptEngine: PromptEngine,
    private readonly artifactStore: ArtifactStore,
  ) {}

  async process(
    output: string,
    context: WorkerContext,
    renderedPrompt: RenderedPrompt,
  ): Promise<ProcessResult> {
    const outputType = context.constraints.requiredOutputType;

    if (!context.role.ownedArtifacts.includes(outputType)) {
      throw new OutputOwnershipError(context.role.id, outputType);
    }

    const contract = renderedPrompt.outputContract;
    const validation = this.promptEngine.validateOutput(output, contract);

    if (!validation.valid) {
      throw new InvalidOutputError(validation.errors);
    }

    const ref = await this.artifactStore.store({
      type: outputType,
      name: `${context.role.id}-output`,
      content: output,
      producedBy: context.role.id,
    });

    return { outputArtifacts: [ref], repairAttempts: 0 };
  }
}
