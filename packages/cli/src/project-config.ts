import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  generateAll,
  getBuiltInWorkflowByName,
  loadRunnerRegistry,
} from '@ai-dev-orchestrator/config-templates';
import { FileSystemConfigurationLoader, REQUIRED_CONFIG_FILES } from '@ai-dev-orchestrator/core';
import type { ValidationReport } from '@ai-dev-orchestrator/ports';
import type { MergedConfiguration, WorkflowDefinition } from '@ai-dev-orchestrator/schemas';

import { getAiDir } from './workspace-paths';

/** True when no `~/.ai/` config exists or no required files are present yet. */
export function shouldUseGeneratedDefaults(): boolean {
  const aiConfigDir = getAiDir();
  if (!existsSync(aiConfigDir)) {
    return true;
  }
  return !REQUIRED_CONFIG_FILES.some((file) => existsSync(join(aiConfigDir, file)));
}

function withGeneratedConfigDir<T>(fn: (aiConfigDir: string) => T): T {
  const tempDir = mkdtempSync(join(tmpdir(), 'ai-orch-config-'));
  try {
    for (const [relativePath, content] of generateAll()) {
      const filePath = join(tempDir, relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }
    return fn(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Load project config from `~/.ai/` files, or generated defaults when no config exists yet. */
export function loadProjectConfig(): MergedConfiguration {
  if (shouldUseGeneratedDefaults()) {
    return withGeneratedConfigDir((aiConfigDir) => {
      const loader = new FileSystemConfigurationLoader();
      return loader.load({ aiConfigDir });
    });
  }
  const loader = new FileSystemConfigurationLoader();
  return loader.load({ aiConfigDir: getAiDir() });
}

/** Validate project config from `~/.ai/` files, or generated defaults when no config exists yet. */
export function validateProjectConfig(): ValidationReport {
  const runnerRegistry = loadRunnerRegistry();
  if (shouldUseGeneratedDefaults()) {
    return withGeneratedConfigDir((aiConfigDir) => {
      const loader = new FileSystemConfigurationLoader();
      return loader.validate({ aiConfigDir, runnerRegistry });
    });
  }
  const loader = new FileSystemConfigurationLoader();
  return loader.validate({ aiConfigDir: getAiDir(), runnerRegistry });
}

/** Resolve the default workflow from built-in system workflows. */
export function loadDefaultWorkflow(): WorkflowDefinition {
  const workflow = getBuiltInWorkflowByName('dev');
  if (!workflow) {
    throw new Error("Failed to load built-in 'dev' workflow.");
  }
  return workflow;
}

/** Resolve workflow from project config or generated defaults. */
export function resolveProjectWorkflow(): WorkflowDefinition | null {
  return loadDefaultWorkflow();
}
