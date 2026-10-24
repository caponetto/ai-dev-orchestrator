import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  ArtifactStore,
  IterationContractRegistry,
  Logger,
  ManifestProducer,
  ManifestWriter,
} from '@ai-dev-orchestrator/ports';
import { renderReport } from '@ai-dev-orchestrator/run-manifest';
import type {
  ArtifactRef,
  PersistedState,
  RunId,
  RunManifest,
  WorkflowRunConfig,
} from '@ai-dev-orchestrator/schemas';

export interface RunReportingSnapshot {
  readonly runId: RunId;
  readonly config: WorkflowRunConfig | null;
  readonly startedAt: number;
  readonly governanceDecisionCount: number;
  readonly escalationCount: number;
  readonly stateHistory: readonly string[];
  readonly stateTimestamps: NonNullable<PersistedState['stateTimestamps']>;
  readonly workerMetricsByRole: NonNullable<PersistedState['workerMetricsByRole']>;
}

/** Owns manifest/report I/O; workflow progression and cleanup remain with the controller. */
export class RunReporting {
  constructor(
    private readonly artifactStore: ArtifactStore,
    private readonly contractRegistry: IterationContractRegistry,
    private readonly manifestProducer: ManifestProducer,
    private readonly logger: Logger,
    private readonly manifestWriter?: ManifestWriter,
  ) {}

  private async collectArtifactInventory(): Promise<{
    refs: ArtifactRef[];
    summaries: { ref: ArtifactRef; producedBy: string; createdAt: string; sizeBytes: number }[];
  }> {
    try {
      const inv = await this.artifactStore.inventory();
      return {
        refs: inv.artifacts.map((a) => a.ref),
        summaries: inv.artifacts.map((a) => ({
          ref: a.ref,
          producedBy: a.producedBy,
          createdAt: a.createdAt,
          sizeBytes: a.sizeBytes,
        })),
      };
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Inventory collection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { refs: [], summaries: [] };
    }
  }

  async writeInterim(getSnapshot: () => RunReportingSnapshot): Promise<void> {
    if (!this.manifestWriter) {
      return;
    }
    try {
      const { refs, summaries } = await this.collectArtifactInventory();
      const snapshot = getSnapshot();
      const manifest = this.manifestProducer.produce({
        runId: snapshot.runId,
        config: {
          startedAt: new Date(snapshot.startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          governanceDecisions: snapshot.governanceDecisionCount,
          escalations: snapshot.escalationCount,
          iterations: [],
          stateTimestamps: snapshot.stateTimestamps,
          repoRoot: snapshot.config?.repoRoot,
        },
        stateHistory: [...snapshot.stateHistory],
        artifactInventory: refs,
        artifactSummaries: summaries,
        journalPath: snapshot.config?.runDir ? join(snapshot.config.runDir, 'journal.jsonl') : '',
        workerMetrics: { ...snapshot.workerMetricsByRole },
        workflowName: snapshot.config?.workflowDefinition.name,
        workflowVersion: snapshot.config?.workflowDefinition.version,
      });
      this.manifestWriter.write(snapshot.runId, {
        ...manifest,
        status: 'running',
        timing: { ...manifest.timing, completedAt: '' },
      });
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Interim manifest write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private writeReportTo(reportPath: string, manifest: RunManifest): void {
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, renderReport(manifest), 'utf8');
    } catch (err: unknown) {
      this.logger.debug(
        `[LifecycleController] Report write failed for ${reportPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  buildEarly(snapshot: RunReportingSnapshot): RunManifest {
    return this.manifestProducer.produce({
      runId: snapshot.runId,
      config: {
        startedAt: new Date(snapshot.startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        governanceDecisions: snapshot.governanceDecisionCount,
        escalations: snapshot.escalationCount,
        iterations: [],
        stateTimestamps: snapshot.stateTimestamps,
        repoRoot: snapshot.config?.repoRoot,
      },
      stateHistory: [...snapshot.stateHistory],
      artifactInventory: [],
      artifactSummaries: [],
      journalPath: snapshot.config?.runDir ? join(snapshot.config.runDir, 'journal.jsonl') : '',
      workerMetrics: { ...snapshot.workerMetricsByRole },
      workflowName: snapshot.config?.workflowDefinition.name,
      workflowVersion: snapshot.config?.workflowDefinition.version,
    });
  }

  writeEarly(snapshot: RunReportingSnapshot): void {
    const manifest = this.buildEarly(snapshot);
    this.manifestWriter?.write(snapshot.runId, manifest);
  }

  async complete(
    getSnapshot: () => RunReportingSnapshot,
  ): Promise<{ manifest: RunManifest; artifactRefs: ArtifactRef[] }> {
    const iterationSummaries = this.contractRegistry.listContracts().map((c) => {
      const s = this.contractRegistry.getIterationState(c.id);
      return {
        contractId: c.id,
        totalIterations: s.currentIteration,
        judgeArbitrations: s.judgeArbitrations,
        finalStatus: s.status,
        findingsTotal: s.findingsTotal,
        findingsResolved: s.findingsResolved,
      };
    });

    const { refs: artifactRefs, summaries: artifactSummaries } =
      await this.collectArtifactInventory();
    const snapshot = getSnapshot();

    const manifest = this.manifestProducer.produce({
      runId: snapshot.runId,
      config: {
        startedAt: new Date(snapshot.startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        governanceDecisions: snapshot.governanceDecisionCount,
        escalations: snapshot.escalationCount,
        iterations: iterationSummaries,
        stateTimestamps: snapshot.stateTimestamps,
        repoRoot: snapshot.config?.repoRoot,
      },
      stateHistory: [...snapshot.stateHistory],
      artifactInventory: artifactRefs,
      artifactSummaries: artifactSummaries,
      journalPath: snapshot.config?.runDir ? join(snapshot.config.runDir, 'journal.jsonl') : '',
      workerMetrics: { ...snapshot.workerMetricsByRole },
      workflowName: snapshot.config?.workflowDefinition.name,
      workflowVersion: snapshot.config?.workflowDefinition.version,
      reportPath: snapshot.config?.runDir ? join(snapshot.config.runDir, 'report.md') : undefined,
    });

    if (this.manifestWriter) {
      this.manifestWriter.write(snapshot.runId, manifest);
    }

    if (snapshot.config?.runDir) {
      this.writeReportTo(join(snapshot.config.runDir, 'report.md'), manifest);
    }
    if (snapshot.config?.reportOutputPath) {
      this.writeReportTo(snapshot.config.reportOutputPath, manifest);
    }

    return { manifest, artifactRefs };
  }
}
