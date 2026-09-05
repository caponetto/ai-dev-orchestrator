import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { generateAll, generateGlobalFiles } from '@ai-dev-orchestrator/config-templates';

import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getAiDir } from '../workspace-paths';

export interface InitOptions {
  readonly force: boolean;
  readonly json: boolean;
  readonly verbose: boolean;
}

export function initCommand(options: InitOptions, formatter: OutputFormatter): ExitCode {
  const aiDir = getAiDir();

  if (existsSync(aiDir) && !options.force) {
    formatter.error({
      code: ExitCode.CONFIGURATION_ERROR,
      message: `Directory already exists: ${aiDir}`,
      remediation: 'Use --force to overwrite existing configuration.',
    });
    return ExitCode.CONFIGURATION_ERROR;
  }

  mkdirSync(aiDir, { recursive: true });
  mkdirSync(join(aiDir, 'runs'), { recursive: true });

  const created: string[] = [];

  for (const [relativePath, content] of generateAll()) {
    const filePath = join(aiDir, relativePath);
    const parentDir = dirname(filePath);
    if (parentDir !== aiDir) {
      mkdirSync(parentDir, { recursive: true });
    }

    if (existsSync(filePath) && !options.force) {
      if (options.verbose) {
        formatter.info(`Skipping existing file: ${relativePath}`);
      }
      continue;
    }

    writeFileSync(filePath, content, 'utf-8');
    created.push(relativePath);
  }

  for (const [relativePath, content] of generateGlobalFiles()) {
    const filePath = join(aiDir, relativePath);
    const parentDir = dirname(filePath);
    mkdirSync(parentDir, { recursive: true });

    if (existsSync(filePath) && !options.force) {
      if (options.verbose) {
        formatter.info(`Skipping existing global file: ${relativePath}`);
      }
      continue;
    }

    writeFileSync(filePath, content, 'utf-8');
    created.push(relativePath);
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        status: 'success',
        directory: aiDir,
        filesCreated: created,
      }) + '\n',
    );
  } else {
    formatter.success(`Initialized ${aiDir}`);
    if (options.verbose) {
      for (const name of created) {
        formatter.info(`Created ${name}`);
      }
      formatter.info('Created runs/');
    }
  }

  return ExitCode.SUCCESS;
}
