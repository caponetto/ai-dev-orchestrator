import type { TokenEstimator } from '@ai-dev-orchestrator/ports';
import type {
  ArtifactContextBlock,
  AssemblyRequest,
  ContextFragment,
  OutputFormatBlock,
  PromptContext,
  RoleContextBlock,
  RulesContextBlock,
  SystemInfoBlock,
  TaskContextBlock,
  TruncationRecord,
} from '@ai-dev-orchestrator/schemas';

import { TokenBudgetManager } from './token-budget-manager';

interface SystemInstruction {
  readonly source: 'organization' | 'project';
  readonly content: string;
}

export class ContextAssembler {
  private readonly tokenEstimator: TokenEstimator;
  private readonly budgetManager: TokenBudgetManager;
  private readonly systemInstructions: SystemInstruction[] = [];
  private projectContextFragments: readonly ContextFragment[] = [];

  constructor(tokenEstimator: TokenEstimator) {
    this.tokenEstimator = tokenEstimator;
    this.budgetManager = new TokenBudgetManager(tokenEstimator);
  }

  addSystemInstruction(instruction: SystemInstruction): void {
    this.systemInstructions.push(instruction);
  }

  clearSystemInstructions(): void {
    this.systemInstructions.length = 0;
  }

  setProjectContextFragments(fragments: readonly ContextFragment[]): void {
    this.projectContextFragments = fragments;
  }

  clearProjectContext(): void {
    this.projectContextFragments = [];
  }

  assemble(
    request: AssemblyRequest,
  ): PromptContext & { readonly truncations: readonly TruncationRecord[] } {
    // Stable prefix — identical across iterations of the same role in the same run
    const systemInfo = this.buildSystemInfoBlock(request);
    const role = this.buildRoleBlock(request);
    const rules = this.buildRulesBlock(request);
    const outputFormat = this.buildOutputFormatBlock(request);

    // Volatile suffix — changes between iterations
    const rawArtifacts = this.buildArtifactBlocks(request);
    const task = this.buildTaskBlock(request);

    const nonArtifactTokens =
      this.tokenEstimator.estimate(JSON.stringify(systemInfo)) +
      this.tokenEstimator.estimate(JSON.stringify(role)) +
      this.tokenEstimator.estimate(JSON.stringify(rules)) +
      this.tokenEstimator.estimate(JSON.stringify(outputFormat)) +
      this.tokenEstimator.estimate(JSON.stringify(task));

    const { artifacts, truncations } = this.budgetManager.applyBudget(
      rawArtifacts,
      nonArtifactTokens,
      request.tokenBudget,
    );

    const totalTokenEstimate =
      nonArtifactTokens + artifacts.reduce((sum, a) => sum + a.tokenEstimate, 0);

    return {
      systemInfo,
      role,
      rules,
      outputFormat,
      artifacts,
      task,
      totalTokenEstimate,
      truncations,
    };
  }

  private buildRoleBlock(request: AssemblyRequest): RoleContextBlock {
    return {
      name: request.role.name,
      description: request.role.description,
      ownedArtifacts: [...request.role.ownedArtifacts],
      readableArtifacts: [...request.role.readableArtifacts],
      forbiddenArtifacts: [...request.role.forbiddenArtifacts],
    };
  }

  private buildArtifactBlocks(request: AssemblyRequest): readonly ArtifactContextBlock[] {
    return request.inputArtifacts.map((artifact) => ({
      ref: artifact.ref,
      content: artifact.content,
      tokenEstimate: this.tokenEstimator.estimate(artifact.content),
    }));
  }

  private buildTaskBlock(request: AssemblyRequest): TaskContextBlock {
    return {
      requiredOutputType: request.constraints.requiredOutputType,
      constraints: `Max output tokens: ${String(request.constraints.maxOutputTokens)}, Timeout: ${String(request.constraints.timeout)}ms`,
    };
  }

  private buildRulesBlock(request: AssemblyRequest): RulesContextBlock {
    const rules: string[] = [];

    for (const instruction of this.systemInstructions) {
      rules.push(instruction.content);
    }

    rules.push(`You are the ${request.role.name} role.`);
    rules.push(request.role.description);
    if (request.role.forbiddenArtifacts.length > 0) {
      rules.push(
        `You must NOT produce artifacts of types: ${request.role.forbiddenArtifacts.join(', ')}`,
      );
    }

    if (this.projectContextFragments.length > 0) {
      rules.push('## Project Context');
      for (const fragment of this.projectContextFragments) {
        rules.push(fragment.content);
      }
    }

    return { rules };
  }

  private buildOutputFormatBlock(request: AssemblyRequest): OutputFormatBlock {
    const schema = request.constraints.outputSchema;
    return {
      format: request.constraints.requiredOutputType,
      schema: schema ?? undefined,
    };
  }

  private buildSystemInfoBlock(request: AssemblyRequest): SystemInfoBlock {
    return {
      runId: request.systemContext.runId,
      currentState: request.systemContext.currentState,
      iterationCount: request.systemContext.iterationCount,
      timestamp: new Date().toISOString(),
    };
  }
}
