import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { ARTIFACT_DESCRIPTORS, safeJsonParse } from '@ai-orchestrator/artifacts';
import { DefaultStatePersistence } from '@ai-orchestrator/core';
import type { DashboardDataSources, FindingData } from '@ai-orchestrator/dashboard-server';
import { toDashboardEvent } from '@ai-orchestrator/dashboard-server';
import { buildContracts } from '@ai-orchestrator/governance';
import { DefaultJournalReader } from '@ai-orchestrator/journal';
import { DefaultManifestQuery } from '@ai-orchestrator/run-manifest';
import type {
  AgentSessionSnapshot,
  ArtifactSummary,
  ArtifactType,
  DashboardEvent,
  PersistedState,
  TransitionRecord,
  WorkflowDefinition,
} from '@ai-orchestrator/schemas';
import {
  ARTIFACT_TYPES,
  ARTIFACTS_DIR_NAME,
  INVENTORY_FILENAME,
  WORKFLOW_DEFINITION_FILENAME,
  workflowSchema,
} from '@ai-orchestrator/schemas';
import { hashContent } from '@ai-orchestrator/utils';
import { parse as parseYaml } from 'yaml';

import { loadWorkflowFromConfig } from '../composition-root';
import { loadDefaultWorkflow, loadProjectConfig } from '../project-config';
import { discoverRunManifest, discoverRunManifests } from '../run-discovery';
import { getConfigSnapshotPath, getJournalPath, getRunsDir } from '../workspace-paths';

// ---------------------------------------------------------------------------
// Workflow definition extractors
// ---------------------------------------------------------------------------

function resolveWorkflowForRun(runId: string, runsDir: string): WorkflowDefinition {
  const defPath = join(runsDir, runId, WORKFLOW_DEFINITION_FILENAME);
  if (existsSync(defPath)) {
    try {
      const result = safeJsonParse(readFileSync(defPath, 'utf-8'), workflowSchema);
      if (result.success) {
        return result.data;
      }
    } catch {
      /* fall through */
    }
  }

  const fromConfig = loadWorkflowFromConfig();
  if (fromConfig) {
    return fromConfig;
  }

  return loadDefaultWorkflow();
}

function stateNamesFromDefinition(definition: WorkflowDefinition): readonly string[] {
  return Object.keys(definition.states);
}

function stateTypesFromDefinition(
  definition: WorkflowDefinition,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(definition.states).map(([id, def]) => [id, def.type]));
}

function stateLabelsFromDefinition(
  definition: WorkflowDefinition,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(definition.states)
      .filter(([, def]) => def.label != null)
      .map(([id, def]) => [id, def.label as string]),
  );
}

function definitionTransitionsFromDefinition(
  definition: WorkflowDefinition,
): readonly { from: string; to: string; trigger: string }[] {
  const result: { from: string; to: string; trigger: string }[] = [];
  for (const [stateId, state] of Object.entries(definition.states)) {
    for (const t of state.transitions) {
      result.push({
        from: stateId,
        to: t.target,
        trigger: t.trigger,
      });
    }
  }
  return result;
}

/** @internal Exported for testing. */
export function parallelStatesFromDefinition(
  definition: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();
  for (const [stateId, state] of Object.entries(definition.states)) {
    for (const action of state.entryActions ?? []) {
      if (action.type === 'dispatch_parallel_workers') {
        const roles = action.params['roles'];
        if (Array.isArray(roles)) {
          result.set(stateId, roles);
        }
      }
    }
  }
  return result;
}

/** @internal Exported for testing. */
export function dynamicParallelStatesFromDefinition(
  definition: WorkflowDefinition,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [stateId, state] of Object.entries(definition.states)) {
    for (const action of state.entryActions ?? []) {
      if (action.type === 'dispatch_dynamic_workers') {
        result.set(stateId, action.params.role);
      }
    }
  }
  return result;
}

/** @internal Exported for testing. */
export function stateRolesFromDefinition(
  definition: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const [stateId, state] of Object.entries(definition.states)) {
    for (const action of state.entryActions ?? []) {
      if (action.type === 'dispatch_worker') {
        let roles = result.get(stateId);
        if (!roles) {
          roles = [];
          result.set(stateId, roles);
        }
        roles.push(action.params.role);
      } else if (action.type === 'dispatch_parallel_workers') {
        let existing = result.get(stateId);
        if (!existing) {
          existing = [];
          result.set(stateId, existing);
        }
        existing.push(...action.params.roles);
      } else if (action.type === 'dispatch_dynamic_workers') {
        let roles = result.get(stateId);
        if (!roles) {
          roles = [];
          result.set(stateId, roles);
        }
        roles.push(action.params.role);
      }
    }
  }
  return result;
}

/** @internal Exported for testing. */
export function stateScriptsFromDefinition(
  definition: WorkflowDefinition,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const [stateId, state] of Object.entries(definition.states)) {
    for (const action of state.entryActions ?? []) {
      if (action.type === 'run_script') {
        let scripts = result.get(stateId);
        if (!scripts) {
          scripts = [];
          result.set(stateId, scripts);
        }
        scripts.push(action.params.script);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Journal / transition / finding readers
// ---------------------------------------------------------------------------

function readTransitionRecords(runsDir: string, runId: string): readonly TransitionRecord[] {
  const journalPath = getJournalPath(join(runsDir, runId));
  if (!existsSync(journalPath)) {
    return [];
  }

  const reader = new DefaultJournalReader(journalPath);
  const events = reader.readAll();

  const transitions: TransitionRecord[] = [];
  for (const e of events) {
    if (e.type !== 'state_transition') {
      continue;
    }
    transitions.push({
      timestamp: e.timestamp,
      runId: e.runId,
      from: e.data.from,
      to: e.data.to,
      trigger: e.data.trigger,
      guardsEvaluated: [],
      governanceDecision: e.data.governanceOutcome,
      durationMs: e.data.durationMs,
    });
  }
  return transitions;
}

function readFindings(runsDir: string, runId: string): readonly FindingData[] {
  const journalPath = getJournalPath(join(runsDir, runId));
  if (!existsSync(journalPath)) {
    return [];
  }

  const reader = new DefaultJournalReader(journalPath);
  const events = reader.readAll();

  const findingMap = new Map<string, FindingData>();
  let iterationCounter = 0;

  for (const e of events) {
    if (e.type !== 'finding_raised' && e.type !== 'finding_resolved') {
      continue;
    }
    const d = e.data as unknown as Record<string, unknown>;
    if (
      typeof d.findingId !== 'string' ||
      typeof d.severity !== 'string' ||
      typeof d.status !== 'string'
    ) {
      continue;
    }

    const existing = findingMap.get(d.findingId);
    if (existing) {
      findingMap.set(d.findingId, { ...existing, status: d.status });
    } else {
      findingMap.set(d.findingId, {
        id: d.findingId,
        severity: d.severity,
        status: d.status,
        category: typeof d.category === 'string' ? d.category : 'review',
        description: typeof d.title === 'string' ? d.title : '',
        source: d.blocking === 'true' ? 'blocking' : 'review',
        iteration: iterationCounter++,
      });
    }
  }

  return [...findingMap.values()];
}

function buildContractLimits(): Record<string, number> {
  const limits: Record<string, number> = {};
  const config = loadProjectConfig();
  const contracts = buildContracts(config.governance.iterationLimits.defaults);
  for (const c of contracts) {
    limits[c.id] = c.maxIterations;
  }
  return limits;
}

// ---------------------------------------------------------------------------
// Artifact readers
// ---------------------------------------------------------------------------

const KNOWN_ARTIFACT_TYPES = new Set<ArtifactSummary['type']>(ARTIFACT_TYPES);

const DEFAULT_PRODUCER: Partial<Record<ArtifactType, string>> = {};
for (const key of ARTIFACT_TYPES) {
  const label = ARTIFACT_DESCRIPTORS[key].producerLabel;
  if (label != null) {
    DEFAULT_PRODUCER[key] = label;
  }
}

/** @internal Exported for testing. */
export function deduplicateByType(
  artifacts: readonly ArtifactSummary[],
): readonly ArtifactSummary[] {
  const best = new Map<string, ArtifactSummary>();
  for (const a of artifacts) {
    const key = `${a.type}/${String(a.version)}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, a);
    }
  }
  return [...best.values()];
}

/** @internal Exported for testing. */
export function inferArtifactTypeFromFilename(name: string): ArtifactSummary['type'] | undefined {
  const normalized = name.replaceAll('-', '_');
  for (const knownType of KNOWN_ARTIFACT_TYPES) {
    if (
      normalized === knownType ||
      normalized.startsWith(`${knownType}-`) ||
      normalized.startsWith(`${knownType}_`)
    ) {
      return knownType;
    }
  }
  return undefined;
}

const ARTIFACT_CONTENT_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml', '.txt']);

function listArtifactFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(fullPath));
    } else if (
      entry.isFile() &&
      !entry.name.includes('.meta') &&
      ARTIFACT_CONTENT_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function readArtifactFileEntries(
  runsDir: string,
  runId: string,
): ReadonlyArray<{ summary: ArtifactSummary; filePath: string }> {
  const artifactsDir = join(runsDir, runId, ARTIFACTS_DIR_NAME);
  if (!existsSync(artifactsDir)) {
    return [];
  }

  let files: string[];
  try {
    files = listArtifactFiles(artifactsDir);
  } catch {
    return [];
  }

  return files
    .map((filePath) => {
      const stat = statSync(filePath);
      const content = readFileSync(filePath);
      const relativePath = relative(artifactsDir, filePath);
      const segments = relativePath.split('/');
      const rawName = basename(filePath, extname(filePath));
      const versionMatch = /^(.*)_v(\d+)$/.exec(rawName);
      const nameWithoutVersion = versionMatch?.[1] ?? rawName;
      const typeSegment = segments.length > 1 ? segments[0] : undefined;
      let artifactType: ArtifactSummary['type'];
      let artifactName: string;
      if (typeSegment && KNOWN_ARTIFACT_TYPES.has(typeSegment as ArtifactSummary['type'])) {
        artifactType = typeSegment as ArtifactSummary['type'];
        artifactName = nameWithoutVersion;
      } else {
        const inferredType = inferArtifactTypeFromFilename(nameWithoutVersion);
        if (!inferredType) {
          return undefined;
        }
        artifactType = inferredType;
        artifactName = nameWithoutVersion;
      }
      const version = versionMatch ? Number(versionMatch[2]) : 1;
      const checksum = hashContent(content);

      return {
        summary: {
          ref: {
            type: artifactType,
            name: artifactName,
            version,
            checksum,
          },
          type: artifactType,
          name: artifactName,
          version,
          producedBy: DEFAULT_PRODUCER[artifactType] ?? '',
          createdAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        },
        filePath,
      };
    })
    .filter(
      (entry): entry is { summary: ArtifactSummary; filePath: string } => entry !== undefined,
    );
}

function readArtifactFiles(runsDir: string, runId: string): readonly ArtifactSummary[] {
  return readArtifactFileEntries(runsDir, runId).map(({ summary }) => summary);
}

function readInventoryArtifacts(runsDir: string, runId: string): readonly ArtifactSummary[] {
  const inventoryPath = join(runsDir, runId, INVENTORY_FILENAME);
  if (!existsSync(inventoryPath)) {
    return readArtifactFiles(runsDir, runId);
  }

  try {
    const raw = parseYaml(readFileSync(inventoryPath, 'utf8')) as {
      artifacts?: Array<{
        ref?: { type?: string; name?: string; version?: number; checksum?: string };
        type?: string;
        name?: string;
        version?: number;
        checksum?: string;
        producedBy?: string;
        createdAt?: string;
        sizeBytes?: number;
      }>;
    };

    const inventoryArtifacts = (raw.artifacts ?? [])
      .filter((artifact) => {
        const checksum = artifact.checksum ?? artifact.ref?.checksum;
        return (
          typeof artifact.type === 'string' &&
          typeof artifact.name === 'string' &&
          typeof artifact.version === 'number' &&
          typeof checksum === 'string'
        );
      })
      .map((artifact) => ({
        ref: {
          type: artifact.type as ArtifactSummary['type'],
          name: artifact.name as string,
          version: artifact.version as number,
          checksum: (artifact.checksum ?? artifact.ref?.checksum) as string,
        },
        type: artifact.type as ArtifactSummary['type'],
        name: artifact.name as string,
        version: artifact.version as number,
        producedBy: typeof artifact.producedBy === 'string' ? artifact.producedBy : '',
        createdAt: typeof artifact.createdAt === 'string' ? artifact.createdAt : '',
        sizeBytes: typeof artifact.sizeBytes === 'number' ? artifact.sizeBytes : 0,
      }));
    if (inventoryArtifacts.length === 0) {
      return readArtifactFiles(runsDir, runId);
    }

    const dedupedInventory = deduplicateByType(inventoryArtifacts);
    const inventoryKeys = new Set(dedupedInventory.map((a) => `${a.type}/${String(a.version)}`));
    const fsArtifacts = readArtifactFiles(runsDir, runId);
    const orphans = fsArtifacts.filter((a) => {
      const key = `${a.type}/${String(a.version)}`;
      return !inventoryKeys.has(key);
    });
    return orphans.length > 0 ? [...dedupedInventory, ...orphans] : dedupedInventory;
  } catch {
    return readArtifactFiles(runsDir, runId);
  }
}

// ---------------------------------------------------------------------------
// Journal-to-dashboard event mapping
// ---------------------------------------------------------------------------

const JOURNAL_TYPE_TO_DASHBOARD: Readonly<Record<string, string>> = {
  run_started: 'run.started',
  state_transition: 'transition.completed',
  artifact_stored: 'artifact.stored',
  finding_raised: 'finding.raised',
  finding_resolved: 'finding.accepted',
  worker_dispatched: 'worker.dispatched',
  worker_completed: 'worker.completed',
  budget_threshold_crossed: 'budget.threshold_crossed',
  run_completed: 'run.completed',
  run_aborted: 'run.aborted',
};

function readDashboardEvents(runsDir: string, runId: string): readonly DashboardEvent[] {
  const journalPath = getJournalPath(join(runsDir, runId));
  if (!existsSync(journalPath)) {
    return [];
  }

  const reader = new DefaultJournalReader(journalPath);
  return reader
    .readAll()
    .flatMap((event) => {
      const mappedType = JOURNAL_TYPE_TO_DASHBOARD[event.type];
      if (!mappedType) {
        return [];
      }

      const dashboardEvent = toDashboardEvent({
        type: mappedType,
        timestamp: event.timestamp,
        runId: event.runId,
        payload: event.data,
      });
      return dashboardEvent ? [dashboardEvent] : [];
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunnerHealthEntry {
  readonly id: string;
  readonly available: boolean;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly summary: string;
  readonly version?: string;
}

const HUMAN_WAIT_STATES = new Set(['WAITING_FOR_HUMAN']);

function tryLoadState(
  statePersistence: DefaultStatePersistence,
  runId: string,
): PersistedState | null {
  try {
    return statePersistence.load(runId as Parameters<typeof statePersistence.load>[0]);
  } catch {
    return null;
  }
}

export function buildDataSources(
  runnerHealth: readonly RunnerHealthEntry[] = [],
): DashboardDataSources & { getRunEvents: (runId: string) => readonly DashboardEvent[] } {
  const runsDir = getRunsDir();
  const statePersistence = new DefaultStatePersistence(runsDir);
  const manifestQuery = existsSync(runsDir) ? new DefaultManifestQuery(runsDir) : null;

  const sources: DashboardDataSources = {
    getEngineState: (runId) => {
      const state = tryLoadState(statePersistence, runId);
      if (!state) {
        const manifest = discoverRunManifest(runId);
        if (!manifest) {
          return null;
        }
        const workflow = resolveWorkflowForRun(runId, runsDir);
        return {
          runId: manifest.runId,
          currentState: manifest.finalState || workflow.initialState,
          previousState: null,
          stateEnteredAt: manifest.timing.startedAt,
          transitionCount: 0,
          isWaitingForHuman: manifest.status === 'waiting',
        };
      }
      return {
        runId: state.runId,
        currentState: state.currentState,
        previousState: state.previousState,
        stateEnteredAt: state.stateEnteredAt,
        transitionCount: state.transitionCount,
        isWaitingForHuman: HUMAN_WAIT_STATES.has(state.currentState),
        waitingContext: state.waitingContext,
      };
    },
    getStartedAt: (runId) => {
      const state = tryLoadState(statePersistence, runId);
      if (state?.stateTimestamps?.[0]?.enteredAt) {
        return state.stateTimestamps[0].enteredAt;
      }
      return discoverRunManifest(runId)?.timing.startedAt ?? null;
    },
    getStateNames: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return stateNamesFromDefinition(wf);
    },
    getStateTypes: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return stateTypesFromDefinition(wf);
    },
    getStateLabels: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return stateLabelsFromDefinition(wf);
    },
    getTransitionRecords: (runId) => readTransitionRecords(runsDir, runId),
    getDefinitionTransitions: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return definitionTransitionsFromDefinition(wf);
    },
    getParallelStates: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return parallelStatesFromDefinition(wf);
    },
    getDynamicParallelStates: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return dynamicParallelStatesFromDefinition(wf);
    },
    getStateRoles: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return stateRolesFromDefinition(wf);
    },
    getStateScripts: (runId) => {
      const wf = resolveWorkflowForRun(runId, runsDir);
      return stateScriptsFromDefinition(wf);
    },
    getArtifacts: (runId) => {
      const live = readInventoryArtifacts(runsDir, runId);
      if (live.length > 0) {
        return live;
      }
      const manifest = manifestQuery?.get(runId);
      if (manifest && manifest.artifactInventory.length > 0) {
        return manifest.artifactInventory.map((a) => ({
          ref: a.ref,
          type: a.ref.type,
          name: a.ref.name,
          version: a.ref.version,
          producedBy: a.producedBy,
          createdAt: a.createdAt,
          sizeBytes: a.sizeBytes,
        }));
      }
      return [];
    },
    getManifest: (runId) => discoverRunManifest(runId),
    getManifests: () => discoverRunManifests(),
    getPersistedState: (runId) => tryLoadState(statePersistence, runId),
    getFindings: (runId) => readFindings(runsDir, runId),
    getContractLimits: () => buildContractLimits(),
    getArtifactVersionHistory: (ref) => {
      const allManifests = manifestQuery?.list() ?? [];
      const versions: (typeof ref)[] = [];
      for (const m of allManifests) {
        for (const a of m.artifactInventory) {
          if (a.ref.type === ref.type && a.ref.name === ref.name) {
            versions.push(a.ref);
          }
        }
      }
      return versions.length > 0 ? versions : [ref];
    },
    getSubsystemHealth: () => {
      const now = new Date().toISOString();
      const subsystems: {
        subsystem: string;
        status: 'healthy' | 'degraded' | 'unhealthy';
        lastCheckedAt: string;
        consecutiveFailures: number;
        checks: {
          subsystem: string;
          status: 'healthy' | 'degraded' | 'unhealthy';
          message: string;
          checkedAt: string;
          durationMs: number;
          details: Record<string, unknown>;
        }[];
      }[] = [];
      const journalOk = existsSync(runsDir);
      subsystems.push({
        subsystem: 'journal-storage',
        status: journalOk ? 'healthy' : 'degraded',
        lastCheckedAt: now,
        consecutiveFailures: 0,
        checks: [
          {
            subsystem: 'journal-storage',
            status: journalOk ? 'healthy' : 'degraded',
            message: journalOk
              ? 'Runs directory accessible'
              : 'Runs directory not found — will be created on first run',
            checkedAt: now,
            durationMs: 0,
            details: {},
          },
        ],
      });
      const hasManifests = manifestQuery !== null;
      subsystems.push({
        subsystem: 'manifest-store',
        status: 'healthy',
        lastCheckedAt: now,
        consecutiveFailures: 0,
        checks: [
          {
            subsystem: 'manifest-store',
            status: 'healthy',
            message: hasManifests
              ? 'Manifest query available'
              : 'No manifests yet — will appear after first completed run',
            checkedAt: now,
            durationMs: 0,
            details: {},
          },
        ],
      });

      const artifactsOk = existsSync(runsDir);
      subsystems.push({
        subsystem: 'artifact-store',
        status: artifactsOk ? 'healthy' : 'degraded',
        lastCheckedAt: now,
        consecutiveFailures: 0,
        checks: [
          {
            subsystem: 'artifact-store',
            status: artifactsOk ? 'healthy' : 'degraded',
            message: artifactsOk
              ? 'Artifact storage directory accessible'
              : 'Artifact storage not found — will be created on first run',
            checkedAt: now,
            durationMs: 0,
            details: {},
          },
        ],
      });

      const workflowDef = loadWorkflowFromConfig();
      const workflowOk = workflowDef !== null;
      subsystems.push({
        subsystem: 'workflow-engine',
        status: workflowOk ? 'healthy' : 'degraded',
        lastCheckedAt: now,
        consecutiveFailures: 0,
        checks: [
          {
            subsystem: 'workflow-engine',
            status: workflowOk ? 'healthy' : 'degraded',
            message: workflowOk
              ? 'Workflow definition loaded'
              : 'No custom workflow found — using default workflow',
            checkedAt: now,
            durationMs: 0,
            details: {},
          },
        ],
      });

      for (const runner of runnerHealth) {
        subsystems.push({
          subsystem: `runner:${runner.id}`,
          status: runner.status,
          lastCheckedAt: now,
          consecutiveFailures: 0,
          checks: [
            {
              subsystem: `runner:${runner.id}`,
              status: runner.status,
              message: runner.summary,
              checkedAt: now,
              durationMs: 0,
              details: runner.version ? { version: runner.version } : {},
            },
          ],
        });
      }

      return subsystems;
    },
    getArtifactContentText: (_runId, type, name, version) => {
      const legacyContentPath = join(
        runsDir,
        _runId,
        ARTIFACTS_DIR_NAME,
        type,
        `${name}_v${String(version)}.md`,
      );
      try {
        return readFileSync(legacyContentPath, 'utf8');
      } catch {
        // Fall back to raw artifact files
      }

      const fallbackEntry = readArtifactFileEntries(runsDir, _runId).find(
        ({ summary }) =>
          summary.type === type && summary.name === name && summary.version === version,
      );
      if (!fallbackEntry) {
        return null;
      }
      return readFileSync(fallbackEntry.filePath, 'utf8');
    },
    getRunConfig: (_runId) => {
      const configPath = getConfigSnapshotPath(join(runsDir, _runId));
      if (!existsSync(configPath)) {
        return null;
      }
      try {
        const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        delete raw.providers;
        return raw;
      } catch {
        return null;
      }
    },
    clock: () => new Date().toISOString(),
    getSessionSnapshots: (runId: string) => {
      const sessionsDir = join(runsDir, runId, 'sessions');
      if (!existsSync(sessionsDir)) {
        return [];
      }
      try {
        return readdirSync(sessionsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => {
            const content = readFileSync(join(sessionsDir, f), 'utf-8');
            return JSON.parse(content) as AgentSessionSnapshot;
          });
      } catch {
        return [];
      }
    },
  };

  return Object.assign(sources, {
    getRunEvents: (runId: string) => readDashboardEvents(runsDir, runId),
  });
}

export function startJournalPoller(eventStream: { publish: (event: DashboardEvent) => void }): {
  stop: () => void;
} {
  const runsDir = getRunsDir();
  const seenCounts = new Map<string, number>();
  const POLL_INTERVAL_MS = 2000;

  const poll = () => {
    if (!existsSync(runsDir)) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(runsDir);
    } catch {
      return;
    }

    for (const runId of entries) {
      const journalPath = getJournalPath(join(runsDir, runId));
      if (!existsSync(journalPath)) {
        continue;
      }

      const reader = new DefaultJournalReader(journalPath);
      const events = reader.readAll();
      const seen = seenCounts.get(runId) ?? 0;

      if (events.length <= seen) {
        continue;
      }

      for (let i = seen; i < events.length; i++) {
        const je = events[i];
        const mappedType = JOURNAL_TYPE_TO_DASHBOARD[je.type] as string | undefined;
        if (!mappedType) {
          continue;
        }

        const dashEvent = toDashboardEvent({
          type: mappedType,
          timestamp: je.timestamp,
          runId: je.runId,
          payload: je.data,
        });

        if (dashEvent) {
          eventStream.publish(dashEvent);
          if (
            dashEvent.type === 'run_started' ||
            dashEvent.type === 'run_completed' ||
            dashEvent.type === 'run_aborted'
          ) {
            eventStream.publish({
              type: 'health_changed',
              timestamp: dashEvent.timestamp,
              runId: dashEvent.runId,
              data: {},
            });
          }
        }
      }

      seenCounts.set(runId, events.length);
    }
  };

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
