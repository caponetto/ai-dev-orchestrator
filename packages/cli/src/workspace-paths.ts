import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  AI_CONFIG_DIR_NAME,
  ARTIFACTS_DIR_NAME,
  RUNS_DIR_NAME,
  STATE_FILENAME,
} from '@ai-orchestrator/schemas';

const JOURNAL_FILENAME = 'journal.md';
const CONFIG_SNAPSHOT_FILENAME = 'config-snapshot.json';
const LOG_FILENAME = 'orchestrator.log';
const SCRIPTS_DIR_NAME = 'scripts';
const DASHBOARD_LOG_FILENAME = 'dashboard-server.log';
const PERMISSION_APPROVALS_FILENAME = 'permission-approvals.json';

export function getAiDir(): string {
  return join(homedir(), AI_CONFIG_DIR_NAME);
}

export function getRunsDir(): string {
  return join(homedir(), AI_CONFIG_DIR_NAME, RUNS_DIR_NAME);
}

export function getRunDir(runId: string): string {
  return join(homedir(), AI_CONFIG_DIR_NAME, RUNS_DIR_NAME, runId);
}

export function getJournalPath(runDir: string): string {
  return join(runDir, JOURNAL_FILENAME);
}

export function getStatePath(runDir: string): string {
  return join(runDir, STATE_FILENAME);
}

export function getArtifactsDir(runDir: string): string {
  return join(runDir, ARTIFACTS_DIR_NAME);
}

export function getLogPath(runDir: string): string {
  return join(runDir, LOG_FILENAME);
}

export function getConfigSnapshotPath(runDir: string): string {
  return join(runDir, CONFIG_SNAPSHOT_FILENAME);
}

export function getDashboardLogPath(): string {
  return join(homedir(), AI_CONFIG_DIR_NAME, DASHBOARD_LOG_FILENAME);
}

export function getPermissionApprovalsPath(): string {
  return join(homedir(), AI_CONFIG_DIR_NAME, PERMISSION_APPROVALS_FILENAME);
}

export function getScriptsDir(): string {
  return join(homedir(), AI_CONFIG_DIR_NAME, SCRIPTS_DIR_NAME);
}
