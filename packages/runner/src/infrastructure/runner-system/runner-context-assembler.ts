import type {
  ArtifactStore,
  CodeIntelligence,
  DependencyGraph,
  ExecutionAnalytics,
  ProjectContextStore,
  PromptEngine,
  RoleRegistry,
} from '@ai-orchestrator/ports';
import { buildTaskBrief } from '@ai-orchestrator/prompt-engine';
import type {
  ArtifactRef,
  ArtifactType,
  DispatchRequest,
  ModelCalibrationEntry,
  ResolvedArtifact,
  RoleContract,
  TaskBrief,
  WorkerConstraints,
  WorkerContext,
} from '@ai-orchestrator/schemas';
import { learnedPreferencesSchema } from '@ai-orchestrator/schemas';

import { ContextAssemblyError } from '../../domain/runner-system/errors';

/** Assembles the execution context for a worker by resolving artifacts and role configuration. */
export class RunnerContextAssembler {
  private readonly artifactStore: ArtifactStore;
  private readonly roleRegistry: RoleRegistry;
  private readonly promptEngine: PromptEngine;
  private readonly dependencyGraph: DependencyGraph | undefined;
  private readonly codeIntelligence: CodeIntelligence | undefined;
  private readonly repoRoot: string | undefined;
  private readonly projectContextStore: ProjectContextStore | undefined;
  private readonly executionAnalytics: ExecutionAnalytics | undefined;

  constructor(
    artifactStore: ArtifactStore,
    roleRegistry: RoleRegistry,
    promptEngine: PromptEngine,
    dependencyGraph?: DependencyGraph,
    codeIntelligence?: CodeIntelligence,
    repoRoot?: string,
    projectContextStore?: ProjectContextStore,
    executionAnalytics?: ExecutionAnalytics,
  ) {
    this.artifactStore = artifactStore;
    this.roleRegistry = roleRegistry;
    this.promptEngine = promptEngine;
    this.dependencyGraph = dependencyGraph;
    this.codeIntelligence = codeIntelligence;
    this.repoRoot = repoRoot;
    this.projectContextStore = projectContextStore;
    this.executionAnalytics = executionAnalytics;
  }

  /** Assemble the full worker context from a dispatch request. */
  async assemble(request: DispatchRequest): Promise<WorkerContext> {
    const role = this.roleRegistry.getRole(request.role);
    if (!role) {
      throw new ContextAssemblyError(`Role "${request.role}" not found`);
    }

    let modelAssignment;
    if (request.overrides?.model) {
      modelAssignment = request.overrides.model;
    } else {
      try {
        const calibration = await this.readCalibrationData();
        modelAssignment = this.roleRegistry.getRecommendedModel(request.role, calibration);
      } catch {
        modelAssignment = {
          roleId: request.role,
          model: role.runner ?? 'agent',
          maxTokens: 4096,
        };
      }
    }

    if (this.executionAnalytics && !request.overrides?.model) {
      try {
        const defaultTimeout = 600_000;
        const adaptiveConfig = await this.executionAnalytics.getAdaptiveConfig(
          request.role,
          modelAssignment.model,
          {
            maxOutputTokens: modelAssignment.maxTokens ?? 4096,
            maxRetries: 3,
            timeoutMs: request.overrides?.timeout ?? defaultTimeout,
            modelMaxTokens: modelAssignment.maxTokens ?? 200_000,
          },
        );
        if (adaptiveConfig.recommendedMaxOutputTokens !== null) {
          modelAssignment = {
            ...modelAssignment,
            maxTokens: adaptiveConfig.recommendedMaxOutputTokens,
          };
        }
      } catch {
        // Adaptive config is best-effort
      }
    }

    const rawArtifacts = await this.resolveArtifacts(request);
    const inputArtifacts = this.enrichWithCodeIntelligence(rawArtifacts);
    this.verifyAccess(role, inputArtifacts);

    const defaultTimeout = 600_000;
    const constraints: WorkerConstraints = {
      maxOutputTokens: modelAssignment.maxTokens ?? 4096,
      timeout: request.overrides?.timeout ?? defaultTimeout,
      requiredOutputType: role.ownedArtifacts[0],
    };

    const rendered = await this.promptEngine.render({
      role: request.role,
      inputArtifacts,
      constraints,
      systemContext: {
        runId: request.runId,
        currentState: request.stateId,
        iterationCount: request.iterationCount ?? 1,
        humanFeedback: request.humanFeedback,
        previousReviewContent: request.previousReviewContent,
      },
      overrides: request.variableOverrides
        ? { variableOverrides: request.variableOverrides }
        : undefined,
    });

    const schema = rendered.outputContract.schema;
    const enrichedConstraints: WorkerConstraints = {
      ...constraints,
      outputFormat: rendered.outputContract.format,
      ...(typeof schema === 'object' && Object.keys(schema).length > 0
        ? { outputSchema: schema }
        : {}),
    };

    const taskBrief = this.buildTaskBriefSection(role, rendered.text);
    const basePrompt = taskBrief ?? rendered.text;

    const projectContextSection = await this.buildProjectContextSection(request.role);
    const prompt = projectContextSection ? `${basePrompt}\n\n${projectContextSection}` : basePrompt;

    return {
      role,
      prompt,
      inputArtifacts,
      modelAssignment,
      constraints: enrichedConstraints,
    };
  }

  resolveRelevantArtifacts(role: RoleContract): readonly ArtifactType[] {
    const permitted = [...new Set([...role.readableArtifacts, ...role.ownedArtifacts])];

    if (!this.dependencyGraph) {
      return permitted;
    }

    const outputTypes = role.ownedArtifacts;
    const needed = new Set<ArtifactType>();

    for (const outputType of outputTypes) {
      try {
        const deps = this.dependencyGraph.getTransitiveDependencies(outputType);
        for (const dep of deps) {
          needed.add(dep);
        }
      } catch {
        return permitted;
      }
    }

    if (needed.size === 0) {
      return permitted;
    }

    const permittedSet = new Set<ArtifactType>(permitted);
    return [...needed].filter((t) => permittedSet.has(t));
  }

  private enrichWithCodeIntelligence(artifacts: ResolvedArtifact[]): ResolvedArtifact[] {
    const ci = this.codeIntelligence;
    if (!ci || !this.repoRoot) {
      return artifacts;
    }

    if (!artifacts.some((a) => a.ref.type === 'pr_diff_context')) {
      return artifacts;
    }

    if (!ci.isIndexed(this.repoRoot)) {
      return artifacts;
    }

    try {
      ci.indexProject(this.repoRoot);
    } catch {
      return artifacts;
    }

    return artifacts.map((artifact) => {
      if (artifact.ref.type !== 'pr_diff_context') {
        return artifact;
      }

      try {
        const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
        const diff = parsed['diff'];
        if (typeof diff !== 'string') {
          return artifact;
        }

        const codeBundle = ci.symbolsFromRawDiff(diff);
        if (codeBundle.symbols.length === 0 && codeBundle.relatedDefinitions.length === 0) {
          return artifact;
        }

        const enriched = { ...parsed, codeIntelligence: codeBundle };
        return { ref: artifact.ref, content: JSON.stringify(enriched, null, 2) };
      } catch {
        return artifact;
      }
    });
  }

  private async resolveArtifacts(request: DispatchRequest): Promise<ResolvedArtifact[]> {
    if (request.inputArtifacts.length > 0) {
      return this.resolveExplicit(request.inputArtifacts);
    }
    const role = this.roleRegistry.getRole(request.role);
    if (!role) {
      return [];
    }
    const types = this.resolveRelevantArtifacts(role);
    return this.resolveFromRole(types);
  }

  private async resolveExplicit(refs: readonly ArtifactRef[]): Promise<ResolvedArtifact[]> {
    const resolved: ResolvedArtifact[] = [];
    for (const ref of refs) {
      try {
        const artifact = await this.artifactStore.get(ref);
        resolved.push({ ref, content: artifact.content });
      } catch {
        throw new ContextAssemblyError(
          `Failed to resolve artifact: ${ref.type}/${ref.name}@v${String(ref.version)}`,
        );
      }
    }
    return resolved;
  }

  private async resolveFromRole(readableTypes: readonly string[]): Promise<ResolvedArtifact[]> {
    const resolved: ResolvedArtifact[] = [];
    for (const type of readableTypes) {
      try {
        const refs = await this.artifactStore.list({ type: type as ArtifactType });
        if (refs.length === 0) {
          continue;
        }
        const latest = refs.reduce((a, b) => (b.version > a.version ? b : a));
        const artifact = await this.artifactStore.get(latest);
        resolved.push({ ref: artifact.ref, content: artifact.content });
      } catch {
        // Missing artifacts are silently skipped — not all readable artifacts
        // exist at every point in the workflow
      }
    }
    return resolved;
  }

  private verifyAccess(role: RoleContract, artifacts: readonly ResolvedArtifact[]): void {
    for (const artifact of artifacts) {
      const allowed =
        role.readableArtifacts.includes(artifact.ref.type) ||
        role.ownedArtifacts.includes(artifact.ref.type);
      if (!allowed) {
        throw new ContextAssemblyError(
          `Role "${role.id}" does not have read access to artifact type "${artifact.ref.type}"`,
        );
      }
    }
  }

  private buildTaskBriefSection(role: RoleContract, instructions: string): string | null {
    try {
      const brief = buildTaskBrief({
        roleId: role.id,
        instructions,
        businessGoal: role.description,
        targetArtifactType: role.ownedArtifacts[0] ?? 'unknown',
      });
      return this.formatTaskBrief(brief);
    } catch {
      return null;
    }
  }

  private formatTaskBrief(brief: TaskBrief): string {
    const lines = ['## Task Brief', '', '### What', brief.what, '', '### Why', brief.why];
    if (brief.how) {
      lines.push('', '### How', brief.how);
    }
    lines.push('', '### Success Criteria');
    for (const criterion of brief.successCriteria) {
      lines.push(`- [${criterion.id}] ${criterion.description}`);
    }
    return lines.join('\n');
  }

  private async readCalibrationData(): Promise<readonly ModelCalibrationEntry[] | undefined> {
    if (!this.projectContextStore) {
      return undefined;
    }
    try {
      const doc = await this.projectContextStore.read('preferences');
      if (!doc) {
        return undefined;
      }
      const parsed = learnedPreferencesSchema.safeParse(doc.content);
      if (!parsed.success) {
        return undefined;
      }
      return parsed.data.modelCalibration;
    } catch {
      return undefined;
    }
  }

  private async buildProjectContextSection(role: string): Promise<string | null> {
    if (!this.projectContextStore) {
      return null;
    }
    try {
      const fragments = await this.projectContextStore.query({ role, maxTokens: 2000 });
      if (fragments.length === 0) {
        return null;
      }
      const lines = ['## Project Context (from previous runs)'];
      for (const fragment of fragments) {
        lines.push(fragment.content);
      }
      return lines.join('\n\n');
    } catch {
      return null;
    }
  }
}
