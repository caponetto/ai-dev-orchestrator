import type {
  AgentConstraints,
  AgentTask,
  ResolvedArtifact,
  RoleContract,
  WorkerConstraints,
} from '@ai-dev-orchestrator/schemas';

import { extensionForOutputFormat } from './output-format';

export interface AssembleOptions {
  readonly taskId: string;
  readonly role: RoleContract;
  readonly inputArtifacts: readonly ResolvedArtifact[];
  readonly workerConstraints: WorkerConstraints;
  readonly repoRoot: string;
  readonly runDir: string;
  readonly runId: string;
  readonly stateId: string;
  readonly modelHint?: string;
  readonly humanFeedback?: string;
  readonly userPrompt?: string;
  readonly previousFindings?: string;
  readonly iterationCount?: number;
  readonly rolePrompt?: string;
}

export class AgentTaskAssembler {
  assemble(options: AssembleOptions): AgentTask {
    const { role, workerConstraints } = options;
    const configTimeout = role.agentConfig?.timeoutMs;
    const instructions = role.agentConfig?.instructions;
    const extension = extensionForOutputFormat(workerConstraints.outputFormat);
    const constraints: AgentConstraints = {
      timeout: configTimeout ?? workerConstraints.timeout,
      requiredOutputType: workerConstraints.requiredOutputType,
      outputSchema: workerConstraints.outputSchema,
      outputFormat: workerConstraints.outputFormat,
    };

    return {
      taskId: options.taskId,
      runId: options.runId,
      stateId: options.stateId,
      role: role.id,
      description: role.description,
      inputArtifacts: options.inputArtifacts,
      repoRoot: options.repoRoot,
      runDir: options.runDir,
      outputArtifactPath: `${options.runDir}/artifacts/${workerConstraints.requiredOutputType}-${options.taskId}.${extension}`,
      constraints,
      instructions,
      rolePrompt: options.rolePrompt,
      agentConfig: role.agentConfig,
      modelHint: options.modelHint,
      humanFeedback: options.humanFeedback,
      userPrompt: options.userPrompt,
      previousFindings: options.previousFindings,
      iterationCount: options.iterationCount,
    };
  }
}
