import { existsSync } from 'node:fs';

import { DefaultManifestQuery } from '@ai-orchestrator/run-manifest';
import type { RunManifest } from '@ai-orchestrator/schemas';
import { formatDuration } from '@ai-orchestrator/utils';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getRunsDir } from '../workspace-paths';

import { findLatestRunId } from './find-run';

export interface InspectOptions {
  readonly runId: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
}

export function inspectCommand(options: InspectOptions, formatter: OutputFormatter): ExitCode {
  const runsDir = getRunsDir();

  if (!existsSync(runsDir)) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No runs directory found.',
      remediation: 'Start a run first: ai run "your prompt"',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const runId = options.runId ?? findLatestRunId();

  if (!runId) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'No runs found.',
      remediation: 'Start a run first: ai run "your prompt"',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const query = new DefaultManifestQuery(runsDir);
  const manifest = query.get(runId);

  if (!manifest) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `No manifest found for run: ${runId}`,
      remediation: 'The run may still be in progress or the manifest was not generated.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(manifest) + '\n');
    return ExitCode.SUCCESS;
  }

  printManifestSummary(manifest, formatter, options.verbose);
  return ExitCode.SUCCESS;
}

function printManifestSummary(
  manifest: RunManifest,
  formatter: OutputFormatter,
  verbose: boolean,
): void {
  formatter.section(`Run: ${manifest.runId}`);
  formatter.keyValue({
    Status: manifest.status,
    'Final State': manifest.finalState,
    Repository: manifest.repository,
    Workflow: `${manifest.workflow.name} v${manifest.workflow.version}`,
  });

  formatter.section('Timing');
  formatter.keyValue({
    Started: manifest.timing.startedAt,
    Completed: manifest.timing.completedAt,
    Duration: formatDuration(manifest.timing.totalDurationMs),
  });

  if (verbose && manifest.timing.stateTimings.length > 0) {
    formatter.section('State Timings');
    formatter.table(
      ['State', 'Duration', 'Visits'],
      manifest.timing.stateTimings.map((st) => [
        st.stateId,
        formatDuration(st.durationMs),
        String(st.visits),
      ]),
    );
  }

  formatter.section('Token Usage');
  formatter.keyValue({
    'Input Tokens': manifest.tokenUsage.totalInputTokens,
    'Output Tokens': manifest.tokenUsage.totalOutputTokens,
    'Total Tokens': manifest.tokenUsage.totalTokens,
  });

  if (manifest.budgetSummary) {
    formatter.section('Budget');
    const bs = manifest.budgetSummary;
    const budgetPairs: Record<string, unknown> = {};
    if (bs.configuredMaxTokens !== null) {
      budgetPairs['Max Tokens'] = bs.configuredMaxTokens;
    }
    budgetPairs['Budget Exceeded'] = bs.budgetExceeded ? 'Yes' : 'No';
    formatter.keyValue(budgetPairs);
  }

  if (verbose && manifest.activeRoles.length > 0) {
    formatter.section('Role Usage');
    formatter.table(
      ['Role', 'Dispatches', 'Input Tokens', 'Output Tokens', 'Artifacts'],
      manifest.activeRoles.map((r) => [
        r.role,
        String(r.dispatches),
        String(r.inputTokens),
        String(r.outputTokens),
        String(r.artifactsProduced),
      ]),
    );
  }

  formatter.section('Summary');
  const summaryPairs: Record<string, unknown> = {
    'Total Artifacts': manifest.totalArtifacts,
    'Governance Decisions': manifest.governanceDecisions,
    Escalations: manifest.escalations,
    'Human Interventions': manifest.humanInterventions,
    Agreements: manifest.agreements.length,
  };
  if (manifest.reportPath) {
    summaryPairs['Report'] = manifest.reportPath;
  }
  formatter.keyValue(summaryPairs);

  if (verbose && manifest.iterations.length > 0) {
    formatter.section('Iterations');
    formatter.table(
      ['Contract', 'Iterations', 'Findings', 'Resolved', 'Status'],
      manifest.iterations.map((it) => [
        it.contractId,
        String(it.totalIterations),
        String(it.findingsTotal),
        String(it.findingsResolved),
        it.finalStatus,
      ]),
    );
  }

  if (manifest.abortReason) {
    formatter.section('Abort Reason');
    formatter.info(manifest.abortReason);
  }
}
