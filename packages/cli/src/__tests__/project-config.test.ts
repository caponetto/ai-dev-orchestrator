import { existsSync } from 'node:fs';

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), existsSync: vi.fn() };
});

vi.mock('../workspace-paths', () => ({
  getAiDir: vi.fn(() => '/home/user/.ai'),
}));

vi.mock('@ai-dev-orchestrator/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    REQUIRED_CONFIG_FILES: ['config.yaml', 'roles.yaml'],
    FileSystemConfigurationLoader: vi.fn().mockImplementation(() => ({
      load: vi.fn().mockReturnValue({ logLevel: 'info' }),
      validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    })),
  };
});

vi.mock('@ai-dev-orchestrator/config-templates', () => ({
  generateAll: vi.fn().mockReturnValue([]),
  getBuiltInWorkflowByName: vi.fn().mockImplementation((name: string) => {
    if (name === 'dev') {
      return { name: 'dev', version: '1.0.0', states: [] };
    }
    return null;
  }),
  loadRunnerRegistry: vi.fn().mockReturnValue({}),
}));

import {
  shouldUseGeneratedDefaults,
  loadDefaultWorkflow,
  resolveProjectWorkflow,
} from '../project-config';

describe('shouldUseGeneratedDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the .ai directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(shouldUseGeneratedDefaults()).toBe(true);
  });

  it('returns true when the .ai directory exists but has no required files', () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      return path === '/home/user/.ai';
    });
    expect(shouldUseGeneratedDefaults()).toBe(true);
  });

  it('returns false when at least one required config file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(shouldUseGeneratedDefaults()).toBe(false);
  });
});

describe('loadDefaultWorkflow', () => {
  it('returns the built-in dev workflow', () => {
    const workflow = loadDefaultWorkflow();
    expect(workflow.name).toBe('dev');
  });

  it('throws when dev workflow is not found', async () => {
    const { getBuiltInWorkflowByName } = await import('@ai-dev-orchestrator/config-templates');
    vi.mocked(getBuiltInWorkflowByName).mockReturnValueOnce(undefined as never);
    expect(() => loadDefaultWorkflow()).toThrow("Failed to load built-in 'dev' workflow.");
  });
});

describe('resolveProjectWorkflow', () => {
  it('returns the default workflow', () => {
    const workflow = resolveProjectWorkflow();
    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe('dev');
  });
});
