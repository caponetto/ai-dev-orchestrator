import { join } from 'node:path';

import { AgreementGenerator, safeJsonParse } from '@ai-dev-orchestrator/artifacts';
import type {
  AgentStreamBus,
  AgreementGate,
  ArtifactStore,
  JournalWriter,
  Logger,
  RunnerSystem,
  StalenessDetector,
} from '@ai-dev-orchestrator/ports';
import { noopLogger } from '@ai-dev-orchestrator/ports';
import type {
  Action,
  ActionResult,
  ActionUsageSnapshot,
  AgreementParticipant,
  AgreementType,
  ApprovalStatus,
  ArtifactRef,
  ArtifactType,
  ModelAssignment,
  RoleId,
  RunId,
  StreamEventCallback,
  WorkerResult,
} from '@ai-dev-orchestrator/schemas';
import { ARTIFACTS_DIR_NAME } from '@ai-dev-orchestrator/schemas';
import { FRONTMATTER_REGEX, getErrorMessage } from '@ai-dev-orchestrator/utils';
import { z } from 'zod';

import { resolveCanonicalSpecification } from './resolve-canonical-specification';
import { ScriptExecutor } from './script-executor';

const approvalSchema = z
  .object({
    approved: z.boolean().optional(),
    passed: z.boolean().optional(),
  })
  .loose();

const AGREEMENT_PARTICIPANTS: Readonly<
  Partial<Record<AgreementType, readonly AgreementParticipant[]>>
> = {
  planning_agreement: [
    { role: 'planner', action: 'produced' },
    { role: 'plan_reviewer', action: 'reviewed' },
  ],
  implementation_agreement: [
    { role: 'implementer', action: 'produced' },
    { role: 'static_reviewer', action: 'reviewed' },
    { role: 'security_reviewer', action: 'reviewed' },
    { role: 'performance_reviewer', action: 'reviewed' },
    { role: 'adversarial_reviewer', action: 'reviewed' },
    { role: 'design_reviewer', action: 'reviewed' },
    { role: 'docs_reviewer', action: 'reviewed' },
    { role: 'ux_reviewer', action: 'reviewed' },
  ],
  verification_agreement: [{ role: 'verifier', action: 'reviewed' }],
  release_agreement: [{ role: 'summary_writer', action: 'produced' }],
};

const REVIEWER_ARTIFACT_TYPE: Readonly<Partial<Record<RoleId, ArtifactType>>> = {
  plan_reviewer: 'plan_review',
  static_reviewer: 'static_review',
  security_reviewer: 'security_review',
  performance_reviewer: 'performance_review',
  adversarial_reviewer: 'adversarial_review',
  design_reviewer: 'design_review',
  docs_reviewer: 'docs_review',
  ux_reviewer: 'ux_review',
  verifier: 'verification',
  summary_writer: 'release_summary',
  review_findings_writer: 'review_findings',
};

/** Dispatches state entry/exit actions to the appropriate subsystems. */
export class ActionDispatcher {
  private readonly runner: RunnerSystem;
  private readonly artifactStore: ArtifactStore;
  private readonly journalWriter: JournalWriter;
  private readonly logger: Logger;
  private readonly agreementGenerator = new AgreementGenerator();
  private readonly stalenessDetector?: StalenessDetector;
  private readonly agentStreamBus?: AgentStreamBus;
  private readonly agreementGate?: AgreementGate;
  private readonly scriptExecutor: ScriptExecutor;
  private dispatchCounter = 0;
  private userPrompt?: string;
  private workflowName = 'default';
  private workflowVersion = '1.0.0';
  private configVariables: Record<string, string> = {};
  private repoRoot = '';
  private runDir = '';

  constructor(
    runner: RunnerSystem,
    artifactStore: ArtifactStore,
    journalWriter: JournalWriter,
    stalenessDetector?: StalenessDetector,
    agentStreamBus?: AgentStreamBus,
    agreementGate?: AgreementGate,
    logger?: Logger,
  ) {
    this.runner = runner;
    this.artifactStore = artifactStore;
    this.journalWriter = journalWriter;
    this.stalenessDetector = stalenessDetector;
    this.agentStreamBus = agentStreamBus;
    this.agreementGate = agreementGate;
    this.logger = logger ?? noopLogger;
    this.scriptExecutor = new ScriptExecutor({
      journalWriter,
      agentStreamBus,
      logger: this.logger,
    });
  }

  setUserPrompt(prompt: string | undefined): void {
    this.userPrompt = prompt;
  }

  setWorkflowMetadata(name: string, version: string): void {
    this.workflowName = name;
    this.workflowVersion = version;
  }

  setConfigVariables(variables: Record<string, string>): void {
    this.configVariables = variables;
  }

  setRepoRoot(repoRoot: string): void {
    this.repoRoot = repoRoot;
  }

  setRunDir(runDir: string): void {
    this.runDir = runDir;
  }

  getDispatchCounter(): number {
    return this.dispatchCounter;
  }

  setDispatchCounter(value: number): void {
    this.dispatchCounter = value;
  }

  /** Execute a list of actions, returning results for each. */
  async executeAll(
    actions: readonly Action[],
    runId: RunId,
    stateId: string,
    overrides?: { model?: ModelAssignment },
    humanFeedback?: string,
    previousReviewContent?: string,
    iterationCount?: number,
  ): Promise<readonly ActionResult[]> {
    const results: ActionResult[] = [];
    for (const action of actions) {
      const result = await this.execute(
        action,
        runId,
        stateId,
        overrides,
        humanFeedback,
        previousReviewContent,
        iterationCount,
      );
      results.push(result);
    }
    return results;
  }

  private async execute(
    action: Action,
    runId: RunId,
    stateId: string,
    overrides?: { model?: ModelAssignment },
    humanFeedback?: string,
    previousReviewContent?: string,
    iterationCount?: number,
  ): Promise<ActionResult> {
    switch (action.type) {
      case 'dispatch_worker':
        return this.dispatchWorker(
          action,
          runId,
          stateId,
          overrides,
          humanFeedback,
          previousReviewContent,
          iterationCount,
        );
      case 'dispatch_parallel_workers':
        return this.dispatchParallelWorkers(
          action,
          runId,
          stateId,
          humanFeedback,
          previousReviewContent,
          iterationCount,
        );
      case 'dispatch_dynamic_workers':
        return this.dispatchDynamicWorkers(
          action,
          runId,
          stateId,
          humanFeedback,
          previousReviewContent,
          iterationCount,
        );
      case 'run_script':
        return this.runScript(action, runId, stateId);
      case 'store_artifact':
        return this.storeArtifact(action);
      case 'record_journal':
        return this.recordJournal(action, runId);
      case 'generate_agreement':
        return this.generateAgreement(action, runId, stateId);
      case 'produce_manifest':
        return { action, success: true };
      case 'notify_human':
        return { action, success: true };
      default:
        throw new Error(`Unhandled action: ${(action as Action).type}`);
    }
  }

  private async runScript(
    action: Extract<Action, { type: 'run_script' }>,
    runId: RunId,
    stateId: string,
  ): Promise<ActionResult> {
    const dispatchId = `script-${String(++this.dispatchCounter)}`;
    const result = await this.scriptExecutor.execute(action.params, {
      runId,
      stateId,
      repoRoot: this.repoRoot,
      artifactsDir: join(this.runDir, ARTIFACTS_DIR_NAME),
      dispatchId,
      userPrompt: this.userPrompt,
    });

    const storeOutput = action.params.storeOutput;
    if (storeOutput && result.success && result.scriptResult) {
      const stdout = result.scriptResult.stdout.trim();
      if (stdout) {
        try {
          const ref = await this.artifactStore.store({
            type: storeOutput.artifactType as ArtifactType,
            name: `${storeOutput.producedBy}-output`,
            content: stdout,
            producedBy: storeOutput.producedBy,
          });
          return { ...result, artifactRef: ref };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          this.logger.warn(
            `[ActionDispatcher] Failed to store script output as artifact: ${message}`,
          );
        }
      }
    }

    return result;
  }

  private async dispatchWorker(
    action: Extract<Action, { type: 'dispatch_worker' }>,
    runId: RunId,
    stateId: string,
    overrides?: { model?: ModelAssignment },
    humanFeedback?: string,
    previousReviewContent?: string,
    iterationCount?: number,
  ): Promise<ActionResult> {
    try {
      const role = action.params.role;
      const dispatchId = `dispatch-${String(++this.dispatchCounter)}`;
      const onStreamEvent: StreamEventCallback | undefined = this.agentStreamBus
        ? (event) => {
            this.agentStreamBus?.publish({ ...event, runId, stateId, roleId: role, dispatchId });
          }
        : undefined;
      const result = await this.runner.dispatch(
        {
          runId,
          stateId,
          role,
          inputArtifacts: [],
          humanFeedback,
          userPrompt: this.userPrompt,
          previousReviewContent,
          iterationCount,
          variableOverrides:
            Object.keys(this.configVariables).length > 0 ? this.configVariables : undefined,
          ...(overrides?.model ? { overrides: { model: overrides.model } } : {}),
        },
        onStreamEvent,
      );
      const succeeded = result.status === 'success';
      const artifactRef = result.outputArtifacts.at(0);
      if (artifactRef) {
        this.recordStaleness(artifactRef, runId);
      }
      const usageSnapshot: ActionUsageSnapshot = {
        totalInputTokens: result.metrics.inputTokens,
        totalOutputTokens: result.metrics.outputTokens,
        byRole: {
          [result.role]: {
            inputTokens: result.metrics.inputTokens,
            outputTokens: result.metrics.outputTokens,
            durationMs: result.metrics.durationMs,
          },
        },
      };
      return {
        action,
        success: succeeded,
        error: succeeded ? undefined : (result.error?.message ?? 'Worker dispatch failed'),
        errorType: succeeded ? undefined : result.error?.type,
        artifactRef,
        usageSnapshot,
        sessionOutcome: result.sessionOutcome,
        sessionRef: result.sessionRef,
        pendingRequest: result.pendingRequest,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }

  private async dispatchParallelWorkers(
    action: Extract<Action, { type: 'dispatch_parallel_workers' }>,
    runId: RunId,
    stateId: string,
    humanFeedback?: string,
    previousReviewContent?: string,
    iterationCount?: number,
  ): Promise<ActionResult> {
    try {
      const roles = await this.resolveParallelRoles(action);
      const dispatchIds = new Map(
        roles.map((role) => [role, `dispatch-${String(++this.dispatchCounter)}`]),
      );
      const requests = roles.map((role) => ({
        runId,
        stateId,
        role,
        inputArtifacts: [] as ArtifactRef[],
        humanFeedback,
        userPrompt: this.userPrompt,
        previousReviewContent,
        iterationCount,
        variableOverrides:
          Object.keys(this.configVariables).length > 0 ? this.configVariables : undefined,
      }));

      const createStreamCallback = this.agentStreamBus
        ? (request: { readonly role: RoleId }) => {
            const dispatchId = dispatchIds.get(request.role) ?? 'dispatch-unknown';
            const cb: StreamEventCallback = (event) => {
              this.agentStreamBus?.publish({
                ...event,
                runId,
                stateId,
                roleId: request.role,
                dispatchId,
              });
            };
            return cb;
          }
        : undefined;

      const results = await this.runner.dispatchParallel(requests, createStreamCallback);

      const workerResults: WorkerResult[] = results.map((result) => {
        const artifactRef = result.outputArtifacts.at(0);
        if (artifactRef) {
          this.recordStaleness(artifactRef, runId);
        }
        return {
          role: result.role,
          success: result.status === 'success',
          error:
            result.status === 'success'
              ? undefined
              : (result.error?.message ?? 'Worker dispatch failed'),
          errorType: result.status === 'success' ? undefined : result.error?.type,
          artifactRef,
          model: result.metrics.modelUsed || undefined,
        };
      });

      const artifactRefs = workerResults
        .map((w) => w.artifactRef)
        .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const byRole: Record<
        string,
        { inputTokens: number; outputTokens: number; durationMs: number }
      > = {};
      for (const dr of results) {
        totalInputTokens += dr.metrics.inputTokens;
        totalOutputTokens += dr.metrics.outputTokens;
        byRole[dr.role] = {
          inputTokens: dr.metrics.inputTokens,
          outputTokens: dr.metrics.outputTokens,
          durationMs: dr.metrics.durationMs,
        };
      }

      const usageSnapshot: ActionUsageSnapshot = {
        totalInputTokens,
        totalOutputTokens,
        byRole,
      };

      // Only one session-per-wait is tracked; parallel dispatch takes the first awaiting_human.
      // Multi-session wait support is deferred to a future plan.
      const sessionResults = results.filter((r) => r.sessionOutcome && r.sessionRef);
      const awaitingHuman = sessionResults.find((r) => r.sessionOutcome === 'awaiting_human');

      const droppedSessions = sessionResults.filter(
        (r) => r.sessionOutcome === 'awaiting_human' && r !== awaitingHuman,
      );
      if (droppedSessions.length > 0) {
        this.logger.warn(
          `[action-dispatcher] ${String(droppedSessions.length)} additional awaiting_human ` +
            `session(s) dropped — only one session per wait is tracked in v1.`,
        );
      }

      const firstSession = awaitingHuman ?? sessionResults.at(0);

      return {
        action,
        success: workerResults.some((w) => w.success),
        artifactRefs,
        workerResults,
        usageSnapshot,
        sessionOutcome: firstSession?.sessionOutcome,
        sessionRef: firstSession?.sessionRef,
        pendingRequest: firstSession?.pendingRequest,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }

  private async dispatchDynamicWorkers(
    action: Extract<Action, { type: 'dispatch_dynamic_workers' }>,
    runId: RunId,
    stateId: string,
    humanFeedback?: string,
    previousReviewContent?: string,
    iterationCount?: number,
  ): Promise<ActionResult> {
    try {
      const { role, sourceArtifact, itemsPath } = action.params;

      const refs = await this.artifactStore.list({ type: sourceArtifact });
      if (refs.length === 0) {
        return {
          action,
          success: false,
          error: `Source artifact '${sourceArtifact}' not found for dispatch_dynamic_workers`,
        };
      }
      const latestRef = refs[refs.length - 1];
      const artifact = await this.artifactStore.get(latestRef);

      const parsed = safeJsonParse(artifact.content, z.record(z.string(), z.unknown()));
      if (!parsed.success) {
        return {
          action,
          success: false,
          error: `Failed to parse source artifact '${sourceArtifact}' as JSON`,
        };
      }

      const items = this.resolveItemsPath(parsed.data, itemsPath);
      if (!Array.isArray(items) || items.length === 0) {
        return {
          action,
          success: false,
          error: `Items path '${itemsPath}' in artifact '${sourceArtifact}' did not resolve to a non-empty array`,
        };
      }

      const dispatchIds = new Map<object, string>();
      const requests = items.map((item: unknown, index: number) => {
        const req = {
          runId,
          stateId,
          role,
          inputArtifacts: [] as ArtifactRef[],
          humanFeedback,
          userPrompt: this.userPrompt,
          previousReviewContent,
          iterationCount,
          variableOverrides: {
            ...this.configVariables,
            taskItem: JSON.stringify(item),
            taskItemIndex: String(index),
          },
        };
        dispatchIds.set(req, `dispatch-${String(++this.dispatchCounter)}`);
        return req;
      });

      const createStreamCallback = this.agentStreamBus
        ? (request: { readonly role: RoleId }) => {
            const dispatchId = dispatchIds.get(request) ?? 'dispatch-unknown';
            const cb: StreamEventCallback = (event) => {
              this.agentStreamBus?.publish({
                ...event,
                runId,
                stateId,
                roleId: role,
                dispatchId,
              });
            };
            return cb;
          }
        : undefined;

      const results = await this.runner.dispatchParallel(requests, createStreamCallback);

      const workerResults: WorkerResult[] = results.map((result) => {
        const artifactRef = result.outputArtifacts.at(0);
        if (artifactRef) {
          this.recordStaleness(artifactRef, runId);
        }
        return {
          role: result.role,
          success: result.status === 'success',
          error:
            result.status === 'success'
              ? undefined
              : (result.error?.message ?? 'Worker dispatch failed'),
          errorType: result.status === 'success' ? undefined : result.error?.type,
          artifactRef,
          model: result.metrics.modelUsed || undefined,
        };
      });

      const artifactRefs = workerResults
        .map((w) => w.artifactRef)
        .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const byRole: Record<
        string,
        { inputTokens: number; outputTokens: number; durationMs: number }
      > = {};
      for (const dr of results) {
        totalInputTokens += dr.metrics.inputTokens;
        totalOutputTokens += dr.metrics.outputTokens;
        const key = `${dr.role}-${String(results.indexOf(dr))}`;
        byRole[key] = {
          inputTokens: dr.metrics.inputTokens,
          outputTokens: dr.metrics.outputTokens,
          durationMs: dr.metrics.durationMs,
        };
      }

      const usageSnapshot: ActionUsageSnapshot = {
        totalInputTokens,
        totalOutputTokens,
        byRole,
      };

      // Aggregate individual specifications into a single task_specifications artifact
      const successfulSpecs = workerResults
        .filter((w) => w.success && w.artifactRef)
        .map((w, idx) => ({
          taskId:
            items[idx] && typeof items[idx] === 'object' && 'id' in (items[idx] as object)
              ? (items[idx] as Record<string, unknown>)['id']
              : `task-${String(idx).padStart(3, '0')}`,
          specificationRef: w.artifactRef,
        }));

      if (successfulSpecs.length > 0) {
        try {
          const taskSpecsContent = JSON.stringify({
            version: 1,
            specifications: successfulSpecs.map((s) => s.specificationRef),
            tasks: successfulSpecs,
          });
          const taskSpecsRef = await this.artifactStore.store({
            type: 'task_specifications',
            name: 'task_specifications',
            content: taskSpecsContent,
            producedBy: 'system',
          });
          artifactRefs.push(taskSpecsRef);
        } catch (err: unknown) {
          this.logger.warn(
            `[action-dispatcher] Failed to store task_specifications aggregate: ${getErrorMessage(err)}`,
          );
        }
      }

      return {
        action,
        success: workerResults.some((w) => w.success),
        artifactRefs,
        workerResults,
        usageSnapshot,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }

  private resolveItemsPath(data: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private async storeArtifact(
    action: Extract<Action, { type: 'store_artifact' }>,
  ): Promise<ActionResult> {
    try {
      const type = action.params.type;
      const content = action.params.content;
      const name = action.params.name;
      const ref = await this.artifactStore.store({
        type,
        name: name ?? type,
        content,
        producedBy: 'system',
      });
      return { action, success: true, artifactRef: ref };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }

  private async generateAgreement(
    action: Extract<Action, { type: 'generate_agreement' }>,
    runId: RunId,
    stateId: string,
  ): Promise<ActionResult> {
    try {
      const agreementType = action.params.type;
      const participants = AGREEMENT_PARTICIPANTS[agreementType] ?? [];

      const approvalStatus = await this.computeApprovalFromArtifacts(participants);

      const agreement = this.agreementGenerator.generate(
        agreementType,
        runId,
        stateId,
        participants,
        [],
        [],
        approvalStatus,
        'automated',
      );

      const content = this.agreementGenerator.serialize(agreement);
      const ref = await this.artifactStore.store({
        type: agreementType,
        name: agreementType,
        content,
        producedBy: 'governance',
      });

      this.agreementGate?.register(agreementType, {
        exists: true,
        valid: approvalStatus === 'approved',
        approvalStatus,
        artifactRef: ref,
      });

      return { action, success: true, artifactRef: ref };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }

  private async computeApprovalFromArtifacts(
    participants: readonly AgreementParticipant[],
  ): Promise<ApprovalStatus> {
    const reviewers = participants.filter(
      (p) => p.action === 'reviewed' || p.action === 'approved',
    );

    if (reviewers.length === 0) {
      const producers = participants.filter((p) => p.action === 'produced');
      if (producers.length === 0) {
        return 'rejected';
      }
      for (const producer of producers) {
        const artifactType = REVIEWER_ARTIFACT_TYPE[producer.role as RoleId] ?? producer.role;
        const artifactName = `${producer.role}-output`;
        const artifact = await this.artifactStore.getLatest(
          artifactType as ArtifactType,
          artifactName,
        );
        if (!artifact) {
          return 'rejected';
        }
      }
      return 'approved';
    }

    for (const reviewer of reviewers) {
      const artifactType = REVIEWER_ARTIFACT_TYPE[reviewer.role as RoleId] ?? reviewer.role;
      const artifactName = `${reviewer.role}-output`;
      const artifact = await this.artifactStore.getLatest(
        artifactType as ArtifactType,
        artifactName,
      );
      if (!artifact) {
        return 'rejected';
      }
      if (!this.isArtifactApproved(artifact.content)) {
        return 'rejected';
      }
    }
    return 'approved';
  }

  private isArtifactApproved(content: string): boolean {
    const result = safeJsonParse(content, approvalSchema);
    if (result.success) {
      if (result.data.approved !== undefined) {
        return result.data.approved;
      }
      if (result.data.passed !== undefined) {
        return result.data.passed;
      }
    } else {
      const frontmatterMatch = FRONTMATTER_REGEX.exec(content);
      if (frontmatterMatch?.[1]) {
        const approvedMatch = /^approved:\s*(true|false)/m.exec(frontmatterMatch[1]);
        if (approvedMatch) {
          return approvedMatch[1] === 'true';
        }
        const passedMatch = /^passed:\s*(true|false)/m.exec(frontmatterMatch[1]);
        if (passedMatch) {
          return passedMatch[1] === 'true';
        }
      }
    }
    return false;
  }

  private recordStaleness(ref: ArtifactRef, runId: RunId): void {
    if (!this.stalenessDetector) {
      return;
    }
    try {
      const staleSet = this.stalenessDetector.computeStaleSet(ref);
      if (staleSet.staleArtifacts.length > 0) {
        this.journalWriter.append({
          timestamp: new Date().toISOString(),
          runId,
          sequence: 0,
          type: 'artifact_staleness_detected',
          data: {
            kind: 'artifact_staleness',
            trigger: `${ref.type}/${ref.name}@v${String(ref.version)}`,
            staleCount: staleSet.staleArtifacts.length,
            rebuildOrder: staleSet.rebuildOrder,
          },
        });
      }
    } catch {
      // Staleness detection is advisory; failures should not block workflow
    }
  }

  private async resolveParallelRoles(
    action: Extract<Action, { type: 'dispatch_parallel_workers' }>,
  ): Promise<readonly RoleId[]> {
    const { roles, docsOnlyRoles } = action.params;
    if (!docsOnlyRoles || docsOnlyRoles.length === 0) {
      return roles;
    }
    if (await this.isDocsOnlyChange()) {
      this.logger.info('Docs-only change detected — dispatching reduced reviewer set');
      return docsOnlyRoles;
    }
    return roles;
  }

  private async isDocsOnlyChange(): Promise<boolean> {
    try {
      const spec = await resolveCanonicalSpecification(this.artifactStore);
      if (!spec) {
        return false;
      }
      const parsed = safeJsonParse(
        spec.content,
        z.looseObject({
          extensions: z.record(z.string(), z.unknown()).optional(),
        }),
      );
      if (!parsed.success) {
        return false;
      }
      return parsed.data.extensions?.['changeType'] === 'docs_only';
    } catch {
      return false;
    }
  }

  private recordJournal(
    action: Extract<Action, { type: 'record_journal' }>,
    runId: RunId,
  ): ActionResult {
    try {
      const eventType = action.params.event;
      this.journalWriter.append({
        timestamp: new Date().toISOString(),
        runId,
        sequence: 0,
        type: eventType,
        data: {
          kind: 'run_lifecycle',
          workflowName: this.workflowName,
          workflowVersion: this.workflowVersion,
          status: eventType,
        },
      });
      return { action, success: true };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return { action, success: false, error: message };
    }
  }
}
