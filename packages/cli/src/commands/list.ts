import { existsSync } from 'node:fs';

import { formatDuration } from '@ai-dev-orchestrator/utils';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { discoverRunManifests } from '../run-discovery';
import { getRunsDir } from '../workspace-paths';

export interface ListOptions {
  readonly status: string | null;
  readonly limit: number;
  readonly json: boolean;
  readonly verbose: boolean;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString();
}

export function listCommand(options: ListOptions, formatter: OutputFormatter): ExitCode {
  const runsDir = getRunsDir();

  if (!existsSync(runsDir)) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ runs: [] }) + '\n');
    } else {
      formatter.info('No runs found.');
    }
    return ExitCode.SUCCESS;
  }

  let manifests = discoverRunManifests();
  if (options.status) {
    manifests = manifests.filter((manifest) => manifest.status === options.status);
  }

  manifests.sort((a, b) => b.timing.startedAt.localeCompare(a.timing.startedAt));

  if (options.limit > 0) {
    manifests = manifests.slice(0, options.limit);
  }

  if (manifests.length === 0) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ runs: [] }) + '\n');
    } else {
      formatter.info('No runs match the filter criteria.');
    }
    return ExitCode.SUCCESS;
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        runs: manifests.map((m) => ({
          runId: m.runId,
          status: m.status,
          startedAt: m.timing.startedAt,
          duration: m.timing.totalDurationMs,
          totalArtifacts: m.totalArtifacts,
          finalState: m.finalState,
        })),
      }) + '\n',
    );
    return ExitCode.SUCCESS;
  }

  formatter.section(`Runs (${String(manifests.length)})`);

  const headers = ['Run ID', 'Status', 'Started', 'Duration', 'Artifacts'];
  const rows = manifests.map((m) => [
    m.runId,
    m.status,
    formatDate(m.timing.startedAt),
    formatDuration(m.timing.totalDurationMs),
    String(m.totalArtifacts),
  ]);

  formatter.table(headers, rows);

  if (options.verbose) {
    for (const m of manifests) {
      formatter.section(`Run: ${m.runId}`);
      formatter.keyValue({
        Workflow: `${m.workflow.name} v${m.workflow.version}`,
        'Final State': m.finalState,
        'Total Tokens': m.tokenUsage.totalTokens,
        Escalations: m.escalations,
        'Human Interventions': m.humanInterventions,
      });
    }
  }

  return ExitCode.SUCCESS;
}
