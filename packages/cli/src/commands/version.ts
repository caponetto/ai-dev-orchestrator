import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeJsonParse } from '@ai-dev-orchestrator/artifacts';
import { z } from 'zod';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';

export interface VersionOptions {
  readonly json: boolean;
}

interface VersionInfo {
  readonly name: string;
  readonly version: string;
  readonly commitSha: string;
  readonly buildDate: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
}

function getCommitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function getPackageVersion(): { name: string; version: string } {
  try {
    const dir = import.meta.dirname;
    const pkgPath = existsSync(join(dir, '..', 'package.json'))
      ? join(dir, '..', 'package.json')
      : join(dir, '..', '..', 'package.json');
    const pkgSchema = z.object({ name: z.string().optional(), version: z.string().optional() });
    const result = safeJsonParse(readFileSync(pkgPath, 'utf8'), pkgSchema);
    if (!result.success) {
      return { name: 'ai-dev-orchestrator', version: '0.0.0' };
    }
    return {
      name: result.data.name ?? 'ai-dev-orchestrator',
      version: result.data.version ?? '0.0.0',
    };
  } catch {
    return { name: 'ai-dev-orchestrator', version: '0.0.0' };
  }
}

/** Collect version information from package.json, git, and runtime. */
export function collectVersionInfo(): VersionInfo {
  const pkg = getPackageVersion();
  return {
    name: pkg.name,
    version: pkg.version,
    commitSha: getCommitSha(),
    buildDate: new Date().toISOString().split('T')[0] ?? 'unknown',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

export function versionCommand(options: VersionOptions, formatter: OutputFormatter): ExitCode {
  const info = collectVersionInfo();

  if (options.json) {
    process.stdout.write(JSON.stringify(info) + '\n');
    return ExitCode.SUCCESS;
  }

  formatter.section(info.name);
  formatter.keyValue({
    Version: info.version,
    Commit: info.commitSha,
    'Build Date': info.buildDate,
    Node: info.nodeVersion,
    Platform: `${info.platform} ${info.arch}`,
  });

  return ExitCode.SUCCESS;
}
