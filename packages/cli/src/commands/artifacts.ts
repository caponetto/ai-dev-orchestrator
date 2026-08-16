import { existsSync } from 'node:fs';

import { DefaultManifestQuery } from '@ai-orchestrator/run-manifest';
import { formatBytes } from '@ai-orchestrator/utils';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getRunsDir } from '../workspace-paths';

import { findLatestRunId } from './find-run';

export interface ArtifactsOptions {
  readonly runId: string | null;
  readonly type: string | null;
  readonly json: boolean;
  readonly verbose: boolean;
}

export function artifactsCommand(options: ArtifactsOptions, formatter: OutputFormatter): ExitCode {
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

  let artifacts = manifest.artifactInventory;

  if (options.type) {
    const filterType = options.type;
    artifacts = artifacts.filter((a) => a.ref.type === filterType);
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        runId: manifest.runId,
        totalArtifacts: manifest.totalArtifacts,
        totalSizeBytes: manifest.totalArtifactSizeBytes,
        artifacts: artifacts.map((a) => ({
          type: a.ref.type,
          name: a.ref.name,
          version: a.ref.version,
          producedBy: a.producedBy,
          createdAt: a.createdAt,
          sizeBytes: a.sizeBytes,
        })),
      }) + '\n',
    );
    return ExitCode.SUCCESS;
  }

  formatter.section(`Artifacts for run: ${manifest.runId}`);
  formatter.keyValue({
    'Total Artifacts': manifest.totalArtifacts,
    'Total Size': formatBytes(manifest.totalArtifactSizeBytes),
    ...(options.type ? { 'Filtered by type': options.type } : {}),
  });

  if (artifacts.length === 0) {
    formatter.info('No artifacts match the filter.');
    return ExitCode.SUCCESS;
  }

  const headers = options.verbose
    ? ['Type', 'Name', 'Version', 'Producer', 'Created', 'Size']
    : ['Type', 'Name', 'Version', 'Producer', 'Size'];

  const rows = artifacts.map((a) => {
    const base = [a.ref.type, a.ref.name, String(a.ref.version), a.producedBy];
    if (options.verbose) {
      base.push(a.createdAt);
    }
    base.push(formatBytes(a.sizeBytes));
    return base;
  });

  formatter.table(headers, rows);

  return ExitCode.SUCCESS;
}
