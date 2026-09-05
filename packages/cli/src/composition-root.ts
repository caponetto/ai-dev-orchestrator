import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createClaudeCodeAdapter,
  createCodexCliAdapter,
  createCursorCliAdapter,
  normalizeCodexProbeResult,
  normalizeCursorProbeResult,
  normalizeProbeResult,
  probeClaudeCodeCapabilities,
  probeCodexCliCapabilities,
  probeCursorCliCapabilities,
} from '@ai-orchestrator/agent-adapters';
import {
  buildOwnershipOverrides,
  DefaultAgreementGate,
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
  safeJsonParse,
} from '@ai-orchestrator/artifacts';
import {
  ALL_PARTIAL_IDS,
  ALL_ROLE_IDS,
  generatePartialFile,
  generateRolesYaml,
  generateTemplateFile,
  getBuiltInWorkflows,
  getBuiltInWorkflowByName,
  loadRunnerRegistry,
  PARTIALS_DIR,
  TEMPLATES_DIR,
} from '@ai-orchestrator/config-templates';
import { createLogger, DefaultStatePersistence, InMemoryEventBus } from '@ai-orchestrator/core';
import {
  DefaultDependencyGraph,
  DefaultStalenessDetector,
  InMemoryProvenanceTracker,
} from '@ai-orchestrator/dependency-graph';
import { ExecutionAnalyticsService } from '@ai-orchestrator/execution-analytics';
import {
  DefaultGovernanceEngine,
  DefaultIterationContractRegistry,
  buildContracts,
} from '@ai-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-orchestrator/journal';
import {
  DefaultPolicyEngine,
  DefaultPolicyRegistry,
  loadPoliciesFromGovernance,
  PolicyResolver,
} from '@ai-orchestrator/policy-engine';
import { createRunId } from '@ai-orchestrator/ports';
import type {
  AgentRunner,
  AgentStreamBus,
  ArtifactStore,
  ArtifactTypeValidator,
  GovernanceEngine,
  JournalReader,
  JournalWriter,
  PermissionPolicyConfig,
  StatePersistence,
  WorkflowEngine,
} from '@ai-orchestrator/ports';
import { FilesystemProjectContextStore } from '@ai-orchestrator/project-context';
import {
  DefaultPromptEngine,
  DefaultTemplateRegistry,
  DefaultTokenEstimator,
  loadPartialsFromDirectory,
  loadTemplateFromMarkdown,
  loadTemplatesFromDirectory,
} from '@ai-orchestrator/prompt-engine';
import { ShutdownCoordinator } from '@ai-orchestrator/recovery';
import {
  DefaultRoleRegistry,
  loadRolesFromFile,
  loadRolesFromYaml,
} from '@ai-orchestrator/role-system';
import type { DispatchOverride } from '@ai-orchestrator/role-system';
import { DefaultManifestProducer, FilesystemManifestWriter } from '@ai-orchestrator/run-manifest';
import {
  AgentSessionReaper,
  AgentSessionRegistry,
  CliAgentRunner,
  CompositeAgentSessionSupervisor,
  DefaultAgentSessionStore,
  DefaultPermissionPolicy,
  DefaultRunnerSystem,
  FileBackedAgentStreamBus,
  FileBackedLiveRequestStore,
  FileBackedPermissionApprovalStore,
  HttpAgentRunner,
  LocalAgentSessionSupervisor,
  RemoteAgentSessionSupervisor,
  WebSocketProtocolTransport,
} from '@ai-orchestrator/runner';
import type { LiveRequestStore } from '@ai-orchestrator/runner';
import type {
  BudgetConfig,
  MergedConfiguration,
  PartialMap,
  PersistedState,
  PromptTemplate,
  RoleContract,
  RunId,
  WorkflowDefinition,
  WorkflowRunConfig,
} from '@ai-orchestrator/schemas';
import {
  BUILT_IN_CODING_RUNNER_ID,
  WORKFLOW_DEFINITION_FILENAME,
  workflowSchema,
} from '@ai-orchestrator/schemas';
import { LifecycleController } from '@ai-orchestrator/workflow';

import type { ConfigSnapshot } from './config-snapshot';
import { configSnapshotSchema } from './config-snapshot';
import { loadDefaultWorkflow, loadProjectConfig } from './project-config';
import {
  getAiDir,
  getConfigSnapshotPath,
  getJournalPath,
  getLogPath,
  getPermissionApprovalsPath,
  getRunDir,
  getRunsDir,
} from './workspace-paths';

/** Assembled orchestrator dependencies for a single run. */
export interface OrchestratorContext {
  readonly engine: WorkflowEngine;
  readonly journalWriter: JournalWriter;
  readonly journalReader: JournalReader;
  readonly statePersistence: StatePersistence;
  readonly agentStreamBus: AgentStreamBus;
  readonly liveRequestStore: LiveRequestStore;
  readonly artifactStore: ArtifactStore;
  readonly runId: string;
  readonly runDir: string;
  readonly warnings: readonly string[];
  readonly budgetConfig?: BudgetConfig;
  readonly reportOutputPath?: string;
  readonly shutdownCoordinator?: ShutdownCoordinator;
}

// ---------------------------------------------------------------------------
// Shared configuration / loading helpers
// ---------------------------------------------------------------------------

function loadConfiguration(): {
  isFixture: boolean;
  configDispatchOverrides: Record<string, DispatchOverride>;
  configModelAssignments: Record<string, { model: string; maxTokens?: number }>;
  warnings: string[];
  permissionPolicyConfig?: PermissionPolicyConfig;
  mergedConfig: MergedConfiguration;
} {
  const configDispatchOverrides: Record<string, DispatchOverride> = {};
  const configModelAssignments: Record<string, { model: string; maxTokens?: number }> = {};

  const config = loadProjectConfig();

  const warnings: string[] = [];
  const isFixture = process.env['AI_ORCHESTRATOR_FIXTURE'] === '1';

  for (const [roleId, assignment] of Object.entries(config.roles.assignments)) {
    if (assignment.dispatchType || assignment.runner || assignment.agentConfig) {
      configDispatchOverrides[roleId] = {
        dispatchType: assignment.dispatchType,
        runner: assignment.runner,
        agentConfig: assignment.agentConfig,
      };
    }
    if (assignment.model) {
      configModelAssignments[roleId] = {
        model: assignment.model,
        maxTokens: assignment.maxTokens,
      };
    }
  }

  const permissionPolicyConfig = config.roles.permissionPolicy
    ? ({
        defaultAction: config.roles.permissionPolicy.defaultAction,
        rules: config.roles.permissionPolicy.rules as PermissionPolicyConfig['rules'],
        roleTrust: config.roles.permissionPolicy.roleTrust as PermissionPolicyConfig['roleTrust'],
        safeCommands: config.roles.permissionPolicy.safeCommands,
      } as PermissionPolicyConfig)
    : undefined;

  return {
    isFixture,
    configDispatchOverrides,
    configModelAssignments,
    warnings,
    permissionPolicyConfig,
    mergedConfig: config,
  };
}

async function buildRunnerRegistry(
  isFixture: boolean,
  skippedAssignments: string[],
  liveRequestStore?: LiveRequestStore,
  policyConfig?: PermissionPolicyConfig,
): Promise<Map<string, AgentRunner>> {
  if (isFixture) {
    const fixtureContent = JSON.stringify(buildFixtureJsonPayload());
    const fixtureRunner: AgentRunner = {
      dispatch: () =>
        Promise.resolve({
          taskId: 'fixture-task',
          status: 'success' as const,
          artifactContent: fixtureContent,
          durationMs: 1,
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        }),
    };
    return new Map([['fixture', fixtureRunner]]);
  }
  const registry = new Map<string, AgentRunner>();
  const approvalStore = new FileBackedPermissionApprovalStore(getPermissionApprovalsPath());
  await approvalStore.reload();
  const policy = new DefaultPermissionPolicy(policyConfig, approvalStore);

  const cliRunner = new CliAgentRunner({ command: 'claude', args: ['--print'] });
  const httpRunner = new HttpAgentRunner({ endpoint: 'http://localhost:3100/agents' });

  cliRunner.setPermissionPolicy(policy);
  httpRunner.setPermissionPolicy(policy);
  cliRunner.setApprovalStore(approvalStore);

  if (liveRequestStore) {
    cliRunner.setLiveRequestStore(liveRequestStore);
    httpRunner.setLiveRequestStore(liveRequestStore);
  }

  registry.set('cli', cliRunner);
  registry.set('http', httpRunner);

  try {
    const probeResult = await probeClaudeCodeCapabilities();
    const { mode, summary } = normalizeProbeResult(probeResult);

    if (mode === 'unavailable') {
      skippedAssignments.push(
        `${BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE} runner skipped: ${summary}`,
      );
    } else {
      const adapter = createClaudeCodeAdapter(probeResult.capabilities);
      const claudeCodeRunner = new CliAgentRunner({
        command: 'claude',
        args: ['--print'],
        adapter,
      });
      claudeCodeRunner.setPermissionPolicy(policy);
      claudeCodeRunner.setApprovalStore(approvalStore);
      if (liveRequestStore) {
        claudeCodeRunner.setLiveRequestStore(liveRequestStore);
      }
      registry.set(BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE, claudeCodeRunner);
    }
  } catch {
    skippedAssignments.push(
      'claude-code runner skipped: capability probe failed — claude-code adapter unavailable',
    );
  }

  try {
    const cursorProbe = await probeCursorCliCapabilities();
    const { mode: cursorMode, summary: cursorSummary } = normalizeCursorProbeResult(cursorProbe);

    if (cursorMode === 'unavailable' || cursorMode === 'unauthenticated') {
      skippedAssignments.push(
        `${BUILT_IN_CODING_RUNNER_ID.CURSOR} runner skipped: ${cursorSummary}`,
      );
    } else {
      const cursorAdapter = createCursorCliAdapter(cursorProbe.capabilities);
      const cursorRunner = new CliAgentRunner({
        command: 'agent',
        args: ['--print', '--trust'],
        adapter: cursorAdapter,
      });
      cursorRunner.setPermissionPolicy(policy);
      cursorRunner.setApprovalStore(approvalStore);
      if (liveRequestStore) {
        cursorRunner.setLiveRequestStore(liveRequestStore);
      }
      registry.set(BUILT_IN_CODING_RUNNER_ID.CURSOR, cursorRunner);
    }
  } catch {
    skippedAssignments.push(
      'cursor runner skipped: capability probe failed — cursor CLI adapter unavailable',
    );
  }

  try {
    const codexProbe = await probeCodexCliCapabilities();
    const { mode: codexMode, summary: codexSummary } = normalizeCodexProbeResult(codexProbe);
    if (codexMode === 'unavailable' || codexMode === 'unauthenticated') {
      skippedAssignments.push(`${BUILT_IN_CODING_RUNNER_ID.CODEX} runner skipped: ${codexSummary}`);
    } else {
      const codexRunner = new CliAgentRunner({
        command: 'codex',
        args: [
          'exec',
          '--json',
          '--sandbox',
          'workspace-write',
          '-c',
          'sandbox_workspace_write.network_access=true',
        ],
        adapter: createCodexCliAdapter(codexProbe.capabilities),
      });
      codexRunner.setPermissionPolicy(policy);
      codexRunner.setApprovalStore(approvalStore);
      codexRunner.setApprovalStorePath(getPermissionApprovalsPath());
      if (policyConfig) {
        codexRunner.setPermissionPolicyConfig(policyConfig);
      }
      codexRunner.setCodexPermissionBridge({
        runsDir: getRunsDir(),
        cliEntryPath: join(dirname(fileURLToPath(import.meta.url)), 'index.js'),
      });
      if (liveRequestStore) {
        codexRunner.setLiveRequestStore(liveRequestStore);
      }
      registry.set(BUILT_IN_CODING_RUNNER_ID.CODEX, codexRunner);
    }
  } catch {
    skippedAssignments.push(
      'codex runner skipped: capability probe failed — Codex CLI adapter unavailable',
    );
  }

  return registry;
}

function validateRunnerAvailability(
  roleRegistry: DefaultRoleRegistry,
  runnerRegistry: ReadonlyMap<string, AgentRunner>,
): void {
  for (const role of roleRegistry.listRoles()) {
    if (role.runner) {
      if (!runnerRegistry.has(role.runner)) {
        throw new Error(
          `Role "${role.id}" requires runner "${role.runner}" but it is not registered. ` +
            `Available runners: ${[...runnerRegistry.keys()].join(', ') || 'none'}`,
        );
      }
    }
  }
}

function loadRoleContracts(): RoleContract[] {
  const rolesPath = join(getAiDir(), 'roles.yaml');
  if (existsSync(rolesPath)) {
    return loadRolesFromFile(rolesPath);
  }
  return loadRolesFromYaml(generateRolesYaml());
}

function loadPromptTemplates(): PromptTemplate[] {
  const templatesDir = join(getAiDir(), TEMPLATES_DIR);
  if (existsSync(templatesDir)) {
    return loadTemplatesFromDirectory(templatesDir);
  }
  return ALL_ROLE_IDS.map((roleId) => loadTemplateFromMarkdown(generateTemplateFile(roleId)));
}

function loadPromptPartials(): PartialMap {
  const partialsDir = join(getAiDir(), TEMPLATES_DIR, PARTIALS_DIR);
  if (existsSync(partialsDir)) {
    return loadPartialsFromDirectory(partialsDir);
  }
  const partials: Record<string, string> = {};
  for (const id of ALL_PARTIAL_IDS) {
    partials[id] = generatePartialFile(id).trimEnd();
  }
  return partials;
}

function buildFixtureDispatchOverrides(
  roles: readonly RoleContract[],
): Record<string, DispatchOverride> {
  const overrides: Record<string, DispatchOverride> = {};
  for (const role of roles) {
    overrides[role.id] = { runner: 'fixture' };
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Shared orchestrator infrastructure builder
// ---------------------------------------------------------------------------

interface InfraParams {
  readonly runId: string;
  readonly runDir: string;
  readonly repoRoot: string;
  readonly journalWriter: JournalWriter;
}

interface InfraResult {
  readonly engine: LifecycleController;
  readonly statePersistence: DefaultStatePersistence;
  readonly agentStreamBus: AgentStreamBus;
  readonly liveRequestStore: LiveRequestStore;
  readonly artifactStore: ArtifactStore;
  readonly warnings: string[];
  readonly config: MergedConfiguration;
  readonly shutdownCoordinator: ShutdownCoordinator;
  readonly sessionRegistry: AgentSessionRegistry;
  readonly roleRegistry: DefaultRoleRegistry;
}

function createWebSocketTransportFactory(supervisor: RemoteAgentSessionSupervisor): void {
  supervisor.setTransportFactory(async (_ref, meta) => {
    const baseUrl = meta.websocketUrl ?? meta.reconnectUrl;
    let wsUrl = baseUrl;
    if (meta.authHeader) {
      const headers: Record<string, string> = {};
      const [key, ...rest] = meta.authHeader.split(':');
      if (key && rest.length > 0) {
        headers[key.trim()] = rest.join(':').trim();
      }
      const authValue = headers['Authorization'];
      if (authValue) {
        wsUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}auth=${encodeURIComponent(authValue)}`;
      }
    }
    const ws = new globalThis.WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => {
        resolve();
      });
      ws.addEventListener('error', () => {
        reject(new Error('WebSocket connection failed'));
      });
    });
    return new WebSocketProtocolTransport(ws);
  });
}

async function buildOrchestratorInfra(params: InfraParams): Promise<InfraResult> {
  const { runId, runDir, repoRoot, journalWriter } = params;
  const runsDir = getRunsDir();

  const {
    isFixture,
    configDispatchOverrides,
    configModelAssignments,
    warnings,
    permissionPolicyConfig,
    mergedConfig: config,
  } = loadConfiguration();

  const statePersistence = new DefaultStatePersistence(runsDir);
  const manifestProducer = new DefaultManifestProducer();

  const eventBus = new InMemoryEventBus({ runId });
  const roleContracts = loadRoleContracts();
  const ownershipRegistry = new DefaultOwnershipRegistry(buildOwnershipOverrides(roleContracts));
  const typeValidator: ArtifactTypeValidator = isFixture
    ? { validate: () => ({ valid: true }), getSchema: () => null }
    : new DefaultArtifactTypeValidator();
  const artifactStore = new FilesystemArtifactStore(
    runDir,
    runId,
    ownershipRegistry,
    typeValidator,
  );
  const dispatchOverrides = isFixture
    ? buildFixtureDispatchOverrides(roleContracts)
    : Object.keys(configDispatchOverrides).length > 0
      ? configDispatchOverrides
      : undefined;
  const runnerRegistryEntries = loadRunnerRegistry();
  const defaultModel = runnerRegistryEntries[0]?.models[0];
  if (!defaultModel) {
    throw new Error('Runner registry is empty — no default model available');
  }
  const roleRegistry = new DefaultRoleRegistry(
    roleContracts,
    {
      assignments: configModelAssignments,
      defaultAssignment: { model: defaultModel },
    },
    dispatchOverrides,
  );

  const templateRegistry = new DefaultTemplateRegistry();
  for (const t of loadPromptTemplates()) {
    templateRegistry.register(t);
  }
  const tokenEstimator = new DefaultTokenEstimator();
  const partials = loadPromptPartials();
  const promptEngine = new DefaultPromptEngine(templateRegistry, tokenEstimator, partials);

  const provenanceTracker = new InMemoryProvenanceTracker();
  const dependencyGraph = new DefaultDependencyGraph();
  const stalenessDetector = new DefaultStalenessDetector(
    dependencyGraph,
    provenanceTracker,
    artifactStore,
  );

  const liveRequestStore = new FileBackedLiveRequestStore(runsDir);
  const runnerRegistry = await buildRunnerRegistry(
    isFixture,
    warnings,
    liveRequestStore,
    permissionPolicyConfig,
  );
  if (!isFixture) {
    validateRunnerAvailability(roleRegistry, runnerRegistry);
  }

  const sessionStore = new DefaultAgentSessionStore(runsDir);
  const sessionRegistry = new AgentSessionRegistry(sessionStore);
  const localSupervisor = new LocalAgentSessionSupervisor(sessionRegistry);
  const remoteSupervisor = new RemoteAgentSessionSupervisor(sessionRegistry);
  createWebSocketTransportFactory(remoteSupervisor);
  const sessionSupervisor = new CompositeAgentSessionSupervisor([
    localSupervisor,
    remoteSupervisor,
  ]);

  for (const r of runnerRegistry.values()) {
    if (r instanceof CliAgentRunner) {
      r.setSessionSupervisor(localSupervisor);
    }
    if (r instanceof HttpAgentRunner) {
      r.setSessionSupervisor(remoteSupervisor);
    }
  }

  const logger = createLogger(config.runtime.logLevel, getLogPath(runDir));

  const contextStore = new FilesystemProjectContextStore(getAiDir());
  await contextStore.initialize(repoRoot).catch((err: unknown) => {
    logger.debug(
      `[composition-root] Project context store init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  const executionAnalytics = new ExecutionAnalyticsService(contextStore);

  const runner = new DefaultRunnerSystem(artifactStore, roleRegistry, promptEngine, eventBus, {
    provenanceTracker,
    runnerRegistry,
    repoRoot,
    runDir,
    sessionSupervisor,
    dependencyGraph,
    projectContextStore: contextStore,
    executionAnalytics,
  });

  const contracts = buildContracts(config.governance.iterationLimits.defaults);
  const contractRegistry = new DefaultIterationContractRegistry(contracts);
  const agreementGate = isFixture ? undefined : new DefaultAgreementGate(artifactStore);
  const governanceEngine: GovernanceEngine = isFixture
    ? {
        evaluateTransition: () => ({
          allowed: true as const,
          reason: 'Fixture mode — all transitions allowed',
        }),
        checkAgreement: () => ({ exists: true, valid: true }),
        recordDecision: () => {},
      }
    : (() => {
        const policyRegistry = new DefaultPolicyRegistry();
        const policies = loadPoliciesFromGovernance(config.governance);
        const policyResolver = new PolicyResolver(policies);
        const policyEngine = new DefaultPolicyEngine(policyRegistry, policyResolver);
        return new DefaultGovernanceEngine(contractRegistry, {
          agreementGate,
          policyEngine,
          logger,
        });
      })();

  const manifestWriter = new FilesystemManifestWriter(runsDir);
  const agentStreamBus = new FileBackedAgentStreamBus(runsDir);

  const shutdownCoordinator = new ShutdownCoordinator(statePersistence, journalWriter);
  shutdownCoordinator.install();

  const engine = new LifecycleController({
    runner,
    artifactStore,
    governanceEngine,
    contractRegistry,
    journalWriter,
    statePersistence,
    manifestProducer,
    shutdownCoordinator,
    stalenessDetector,
    manifestWriter,
    agentStreamBus,
    agreementGate,
    sessionSupervisor,
    projectContextStore: contextStore,
    roleRegistry,
    executionAnalytics,
    logger,
  });

  return {
    engine,
    statePersistence,
    agentStreamBus,
    liveRequestStore,
    artifactStore,
    warnings,
    config,
    shutdownCoordinator,
    sessionRegistry,
    roleRegistry,
  };
}

// ---------------------------------------------------------------------------
// Public orchestrator factories
// ---------------------------------------------------------------------------

/** Wire all infrastructure and create a fresh orchestrator context for a new run. */
export async function createOrchestrator(repoRoot: string): Promise<OrchestratorContext> {
  const runId = createRunId();
  const runDir = getRunDir(runId);
  mkdirSync(runDir, { recursive: true });

  const journalPath = getJournalPath(runDir);
  const journalWriter = new DefaultJournalWriter(journalPath, runId);
  const journalReader = new DefaultJournalReader(journalPath);

  const infra = await buildOrchestratorInfra({ runId, runDir, repoRoot, journalWriter });

  writeFileSync(
    getConfigSnapshotPath(runDir),
    JSON.stringify(sanitizeConfigForDashboard(infra.config, infra.roleRegistry, repoRoot), null, 2),
    'utf8',
  );

  return {
    engine: infra.engine,
    journalWriter,
    journalReader,
    statePersistence: infra.statePersistence,
    agentStreamBus: infra.agentStreamBus,
    liveRequestStore: infra.liveRequestStore,
    artifactStore: infra.artifactStore,
    runId,
    runDir,
    warnings: infra.warnings,
    budgetConfig: infra.config.governance.budget,
    reportOutputPath: infra.config.runtime.reportOutputPath,
    shutdownCoordinator: infra.shutdownCoordinator,
  };
}

/** Re-wire the orchestrator from an existing run's persisted state. */
export async function resumeOrchestrator(
  repoRoot: string,
  runId: string,
): Promise<OrchestratorContext> {
  const runDir = getRunDir(runId);
  const journalPath = getJournalPath(runDir);

  const journalReader = new DefaultJournalReader(journalPath);
  const existingEvents = journalReader.readAll();
  const startSequence = existingEvents.length;

  const journalWriter = new DefaultJournalWriter(journalPath, runId, startSequence);

  const infra = await buildOrchestratorInfra({ runId, runDir, repoRoot, journalWriter });

  await infra.sessionRegistry.rebuild();

  const sessionStore = new DefaultAgentSessionStore(getRunsDir());
  const reaper = new AgentSessionReaper(sessionStore, {
    retentionMs: 0,
    reapOrphans: true,
    reapTerminal: false,
  });
  void reaper.reap(runId).catch(() => {
    /* best-effort orphan cleanup */
  });

  let checkpoint = infra.statePersistence.load(runId as RunId);
  checkpoint ??= infra.statePersistence.reconstructFromJournal(
    runId as RunId,
    journalReader.readAll(),
  );
  if (checkpoint) {
    const workflow = resolveWorkflowForResume(runDir, checkpoint);
    const sources = readPersistedSources(runDir);
    infra.engine.restore(
      createRunConfig(runId, sources, workflow, {
        maxTokens:
          workflow.budget?.maxTokensPerRun ?? infra.config.governance.budget?.maxTokensPerRun,
        alertThresholds: infra.config.governance.budget?.alertThresholds,
        reportOutputPath: infra.config.runtime.reportOutputPath,
        runDir,
        repoRoot,
      }),
      checkpoint,
    );
  }

  return {
    engine: infra.engine,
    journalWriter,
    journalReader,
    statePersistence: infra.statePersistence,
    agentStreamBus: infra.agentStreamBus,
    liveRequestStore: infra.liveRequestStore,
    artifactStore: infra.artifactStore,
    runId,
    runDir,
    warnings: infra.warnings,
    budgetConfig: infra.config.governance.budget,
    reportOutputPath: infra.config.runtime.reportOutputPath,
    shutdownCoordinator: infra.shutdownCoordinator,
  };
}

// ---------------------------------------------------------------------------
// Workflow / run config helpers
// ---------------------------------------------------------------------------

/** Load the default workflow from built-in system workflows. */
export function loadWorkflowFromConfig(): WorkflowDefinition | null {
  return getBuiltInWorkflowByName('dev');
}

/** Load a specific workflow by name from the built-in registry. */
export function loadWorkflowByName(name: string): WorkflowDefinition | null {
  return getBuiltInWorkflowByName(name) ?? null;
}

/** Load all built-in workflows. */
export function loadAllWorkflows(): WorkflowDefinition[] {
  return getBuiltInWorkflows();
}

function readPersistedSources(runDir: string): readonly string[] {
  const snapshotPath = getConfigSnapshotPath(runDir);
  if (!existsSync(snapshotPath)) {
    return [];
  }
  try {
    const result = safeJsonParse(readFileSync(snapshotPath, 'utf-8'), configSnapshotSchema);
    return result.success ? (result.data.sources ?? []) : [];
  } catch {
    return [];
  }
}

function readPersistedWorkflow(runDir: string): WorkflowDefinition | null {
  const filePath = join(runDir, WORKFLOW_DEFINITION_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const result = safeJsonParse(readFileSync(filePath, 'utf-8'), workflowSchema);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function resolveWorkflowForResume(
  runDir: string,
  checkpoint: Pick<PersistedState, 'workflowName'>,
): WorkflowDefinition {
  return (
    readPersistedWorkflow(runDir) ??
    loadWorkflowByName(checkpoint.workflowName) ??
    loadWorkflowFromConfig() ??
    loadDefaultWorkflow()
  );
}

/** Options for building a WorkflowRunConfig from CLI inputs. */
export interface RunConfigOptions {
  readonly maxTokens?: number;
  readonly alertThresholds?: readonly number[];
  readonly reportOutputPath?: string;
  readonly runDir?: string;
  readonly repoRoot?: string;
}

type PassthroughFields = 'repoRoot' | 'reportOutputPath' | 'runDir';
type _AssertPassthrough = [
  Pick<WorkflowRunConfig, PassthroughFields> extends Pick<RunConfigOptions, PassthroughFields>
    ? true
    : 'ERROR: RunConfigOptions is missing fields from WorkflowRunConfig',
][0];
export type { _AssertPassthrough as _RunConfigPassthroughCheck };

/** Build a workflow run configuration with the given (or default) workflow and governance. */
export function createRunConfig(
  runId: string,
  sources: readonly string[],
  workflowDefinition?: WorkflowDefinition,
  runOptions?: RunConfigOptions,
): WorkflowRunConfig {
  return {
    runId,
    workflowDefinition: workflowDefinition ?? loadDefaultWorkflow(),
    governancePolicy: {},
    roleAssignments: {},
    sources,
    budgetMaxTokens: runOptions?.maxTokens,
    budgetAlertThresholds: runOptions?.alertThresholds,
    reportOutputPath: runOptions?.reportOutputPath,
    runDir: runOptions?.runDir,
    repoRoot: runOptions?.repoRoot,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Produce a safe config snapshot for the dashboard (no secrets). */
function sanitizeConfigForDashboard(
  config: MergedConfiguration,
  roleRegistry: DefaultRoleRegistry,
  repoRoot: string,
): ConfigSnapshot {
  const DEFAULT_TIMEOUT_MS = 600_000;
  const effectiveAssignments = Object.fromEntries(
    roleRegistry.listRoles().map((role) => {
      const model = roleRegistry.getModelAssignment(role.id);
      const agentConfig = {
        ...role.agentConfig,
        timeoutMs: role.agentConfig?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };
      return [
        role.id,
        {
          model: model.model,
          maxTokens: model.maxTokens,
          dispatchType: role.dispatchType,
          runner: role.runner,
          agentConfig,
        },
      ];
    }),
  );
  return {
    repoRoot,
    workflow: config.workflow,
    roles: {
      ...config.roles,
      assignments: effectiveAssignments,
    },
    governance: config.governance,
    runtime: config.runtime,
  };
}

function buildFixtureJsonPayload(): Record<string, unknown> {
  return {
    id: 'fixture-1',
    version: 1,
    title: 'Fixture',
    businessGoal: 'Fixture response',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    specificationRef: {},
    planRef: {},
    testPlanRef: {},
    implementationRef: {},
    verificationRef: {},
    reviewedArtifactRef: {},
    reviewType: 'static_review',
    role: 'fixture',
    approved: true,
    verdict: 'approve',
    rationale: 'Fixture approval',
    summary: 'Fixture summary',
    findings: [],
    tasks: [{ taskId: 'task-1', description: 'Fixture task', files: [], dependencies: [] }],
    passed: true,
    failures: [],
    directives: [],
    reviewArtifactsConsidered: [],
    projectStructure: 'src/',
    conventions: ['fixture'],
    techStack: ['fixture'],
    affectedFiles: [],
    testsWritten: [],
    criteriaResults: [],
    commitMessage: 'fixture',
    prDescription: 'fixture',
    humanSummary: 'Fixture summary',
    planLevelIssue: false,
    needsHuman: false,
    actionItems: [],
  };
}
