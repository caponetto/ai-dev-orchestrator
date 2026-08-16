import type { DiagnosticsEngine } from '@ai-orchestrator/ports';
import type {
  ConfigurationInspection,
  DiagnosticEntry,
  DiagnosticReport,
  DiagnosticReportSummary,
  FailureAnalysis,
  SubsystemDiagnostic,
  Result,
} from '@ai-orchestrator/schemas';
import { err, ok } from '@ai-orchestrator/schemas';

import { DiagnosticsError, FailureAnalysisError } from '../domain/diagnostics-errors';

import type { ConfigurationRule } from './configuration-inspector';
import { inspectConfig } from './configuration-inspector';
import type { RunFailureContext } from './failure-analyzer';
import { analyzeRunFailure } from './failure-analyzer';

export interface DiagnosticsDataSources {
  readonly getFailureContext: (runId: string) => RunFailureContext | null;
  readonly getConfig: () => Readonly<Record<string, unknown>>;
  readonly getConfigRules: () => readonly ConfigurationRule[];
  readonly getSubsystemEntries: (subsystem: string) => readonly DiagnosticEntry[];
  readonly getSubsystemMetrics: (subsystem: string) => Readonly<Record<string, number>>;
  readonly getSubsystemStatus: (subsystem: string) => string;
  readonly listSubsystems: () => readonly string[];
  readonly clock: () => string;
}

export class DefaultDiagnosticsEngine implements DiagnosticsEngine {
  constructor(private readonly sources: DiagnosticsDataSources) {}

  analyzeFailure(runId: string): Result<FailureAnalysis> {
    const context = this.sources.getFailureContext(runId);
    if (!context) {
      return err(new FailureAnalysisError(runId, 'No failure context found'));
    }
    return ok(analyzeRunFailure(context));
  }

  inspectConfiguration(): Result<ConfigurationInspection> {
    const config = this.sources.getConfig();
    const rules = this.sources.getConfigRules();
    return ok(inspectConfig(config, rules, this.sources.clock));
  }

  getSubsystemDiagnostics(subsystem: string): Result<SubsystemDiagnostic> {
    const subsystems = this.sources.listSubsystems();
    if (!subsystems.includes(subsystem)) {
      return err(new DiagnosticsError(subsystem, 'Unknown subsystem'));
    }

    return ok({
      subsystem,
      status: this.sources.getSubsystemStatus(subsystem),
      entries: this.sources.getSubsystemEntries(subsystem),
      metrics: this.sources.getSubsystemMetrics(subsystem),
      checkedAt: this.sources.clock(),
    });
  }

  generateReport(runId?: string): Result<DiagnosticReport> {
    const allEntries: DiagnosticEntry[] = [];
    const subsystemDiagnostics: SubsystemDiagnostic[] = [];

    for (const subsystem of this.sources.listSubsystems()) {
      const entries = this.sources.getSubsystemEntries(subsystem);
      allEntries.push(...entries);
      subsystemDiagnostics.push({
        subsystem,
        status: this.sources.getSubsystemStatus(subsystem),
        entries,
        metrics: this.sources.getSubsystemMetrics(subsystem),
        checkedAt: this.sources.clock(),
      });
    }

    let failureAnalysis: FailureAnalysis | null = null;
    if (runId) {
      const failureResult = this.analyzeFailure(runId);
      if (failureResult.ok) {
        failureAnalysis = failureResult.value;
      }
    }

    const configResult = this.inspectConfiguration();
    const configurationInspection = configResult.ok ? configResult.value : null;

    const summary = buildSummary(allEntries);

    return ok({
      generatedAt: this.sources.clock(),
      runId: runId ?? null,
      entries: allEntries,
      summary,
      failureAnalysis,
      configurationInspection,
      subsystemDiagnostics,
    });
  }
}

function buildSummary(entries: readonly DiagnosticEntry[]): DiagnosticReportSummary {
  const subsystems = new Set<string>();
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let hintCount = 0;
  for (const e of entries) {
    subsystems.add(e.subsystem);
    if (e.severity === 'error') {
      errorCount++;
    } else if (e.severity === 'warning') {
      warningCount++;
    } else if (e.severity === 'info') {
      infoCount++;
    } else {
      hintCount++;
    }
  }
  return {
    totalEntries: entries.length,
    errorCount,
    warningCount,
    infoCount,
    hintCount,
    subsystemsAffected: [...subsystems],
  };
}
