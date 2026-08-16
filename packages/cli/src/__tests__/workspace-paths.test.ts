import { homedir } from 'node:os';
import { join } from 'node:path';

import { AI_CONFIG_DIR_NAME } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  getAiDir,
  getArtifactsDir,
  getDashboardLogPath,
  getJournalPath,
  getLogPath,
  getRunDir,
  getRunsDir,
  getStatePath,
} from '../workspace-paths';

const HOME = homedir();

describe('getAiDir', () => {
  it('returns the .ai directory under home', () => {
    expect(getAiDir()).toBe(join(HOME, AI_CONFIG_DIR_NAME));
  });
});

describe('getRunsDir', () => {
  it('returns the runs directory under .ai', () => {
    expect(getRunsDir()).toBe(join(HOME, AI_CONFIG_DIR_NAME, 'runs'));
  });
});

describe('getRunDir', () => {
  it('returns a specific run directory', () => {
    expect(getRunDir('run-42')).toBe(join(HOME, AI_CONFIG_DIR_NAME, 'runs', 'run-42'));
  });
});

describe('getJournalPath', () => {
  it('returns journal.md inside the run directory', () => {
    expect(getJournalPath('/runs/run-1')).toBe('/runs/run-1/journal.md');
  });
});

describe('getStatePath', () => {
  it('returns state.yaml inside the run directory', () => {
    expect(getStatePath('/runs/run-1')).toBe('/runs/run-1/state.yaml');
  });
});

describe('getArtifactsDir', () => {
  it('returns the artifacts directory inside the run directory', () => {
    expect(getArtifactsDir('/runs/run-1')).toBe('/runs/run-1/artifacts');
  });
});

describe('getLogPath', () => {
  it('returns the orchestrator log path inside the run directory', () => {
    expect(getLogPath('/runs/run-1')).toBe('/runs/run-1/orchestrator.log');
  });
});

describe('getDashboardLogPath', () => {
  it('returns the dashboard server log path under .ai', () => {
    expect(getDashboardLogPath()).toBe(join(HOME, AI_CONFIG_DIR_NAME, 'dashboard-server.log'));
  });
});
