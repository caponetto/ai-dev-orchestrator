import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ContextDocument } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextStoreInitError } from '../../domain/errors';
import { FilesystemProjectContextStore } from '../filesystem-context-store';

describe('FilesystemProjectContextStore', () => {
  let tempDir: string;
  let store: FilesystemProjectContextStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ctx-test-'));
    store = new FilesystemProjectContextStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('getProjectHash returns a deterministic hash for a given path', () => {
    const hash1 = store.getProjectHash('/some/project');
    const hash2 = store.getProjectHash('/some/project');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('getProjectHash returns different hashes for different paths', () => {
    const hash1 = store.getProjectHash('/project-a');
    const hash2 = store.getProjectHash('/project-b');
    expect(hash1).not.toBe(hash2);
  });

  it('throws if read is called before initialize', async () => {
    await expect(() => store.read('codebase')).rejects.toThrow(ContextStoreInitError);
  });

  it('read returns null for uninitialized category', async () => {
    await store.initialize('/some/project');
    const result = await store.read('codebase');
    expect(result).toBeNull();
  });

  it('round-trips write and read for codebase category', async () => {
    await store.initialize('/some/project');
    const doc: ContextDocument = {
      category: 'codebase',
      content: {
        projectName: 'test',
        lastUpdated: '2026-08-11T10:00:00Z',
        lastRunId: 'run-001',
        architecture: { summary: 'Test arch', modules: [], patterns: [] },
        conventions: [],
      },
      lastUpdated: '2026-08-11T10:00:00Z',
      lastRunId: 'run-001',
    };
    await store.write('codebase', doc);
    const result = await store.read('codebase');
    expect(result).not.toBeNull();
    expect(result?.category).toBe('codebase');
  });

  it('query returns empty array when no context exists', async () => {
    await store.initialize('/some/project');
    const results = await store.query({ categories: ['codebase'] });
    expect(results).toEqual([]);
  });

  it('query returns fragments after write', async () => {
    await store.initialize('/some/project');
    await store.write('codebase', {
      category: 'codebase',
      content: {
        projectName: 'test',
        lastUpdated: '2026-08-11T10:00:00Z',
        lastRunId: 'run-001',
        architecture: { summary: 'Hexagonal', modules: [], patterns: [] },
        conventions: [{ rule: 'Use import type', evidence: 'ESLint', discoveredInRun: 'run-001' }],
      },
      lastUpdated: '2026-08-11T10:00:00Z',
    });
    const results = await store.query({ categories: ['codebase'] });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.category).toBe('codebase');
  });

  it('query returns run history fragments', async () => {
    await store.initialize('/some/project');
    await store.write('run_history', {
      category: 'run_history',
      content: {
        lastUpdated: '2026-08-11T10:00:00Z',
        runs: [
          {
            runId: 'run-001',
            timestamp: '2026-08-11T09:00:00Z',
            workflowVariant: 'dev',
            taskSummary: 'Add login endpoint',
            outcome: 'completed',
            compressed: false,
          },
        ],
      },
      lastUpdated: '2026-08-11T10:00:00Z',
    });
    const results = await store.query({ categories: ['run_history'] });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain('Recent Runs');
  });

  it('round-trips write and read for analytics category', async () => {
    await store.initialize('/some/project');
    const doc: ContextDocument = {
      category: 'analytics',
      content: { profiles: [], lastUpdated: '2026-01-01T00:00:00Z' },
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    await store.write('analytics', doc);
    const result = await store.read('analytics');
    expect(result).not.toBeNull();
    expect(result?.category).toBe('analytics');
  });

  it('query excludes analytics from content extraction', async () => {
    await store.initialize('/some/project');
    await store.write('analytics', {
      category: 'analytics',
      content: { profiles: [], lastUpdated: '2026-01-01T00:00:00Z' },
      lastUpdated: '2026-01-01T00:00:00Z',
    });
    const results = await store.query({ categories: ['analytics'] });
    expect(results).toEqual([]);
  });

  it('query respects maxTokens budget', async () => {
    await store.initialize('/some/project');
    const longContent = {
      projectName: 'test',
      lastUpdated: '2026-08-11T10:00:00Z',
      lastRunId: 'run-001',
      architecture: { summary: 'A'.repeat(10000), modules: [], patterns: [] },
      conventions: [],
    };
    await store.write('codebase', {
      category: 'codebase',
      content: longContent,
      lastUpdated: '2026-08-11T10:00:00Z',
    });
    const results = await store.query({ categories: ['codebase'], maxTokens: 50 });
    const totalLength = results.reduce((sum, f) => sum + f.content.length, 0);
    expect(totalLength).toBeLessThanOrEqual(200);
  });

  it('throws ContextStoreInitError when the project directory cannot be created', async () => {
    const blockedBaseDir = join(tempDir, 'blocked-base');
    await writeFile(blockedBaseDir, 'not-a-directory');

    const blockedStore = new FilesystemProjectContextStore(blockedBaseDir);

    await expect(blockedStore.initialize('/some/project')).rejects.toThrow(ContextStoreInitError);
  });

  it('throws ContextReadError for unexpected read failures', async () => {
    await store.initialize('/some/project');
    const projectDir = join(tempDir, 'projects', store.getProjectHash('/some/project'));
    const badFile = join(projectDir, 'codebase.json');
    await mkdir(badFile, { recursive: true });

    await expect(store.read('codebase')).rejects.toThrow('Failed to read context category');
  });

  it('extracts preferences content and respects a truncation edge case', async () => {
    await store.initialize('/some/project');
    await store.write('preferences', {
      category: 'preferences',
      content: {
        failurePatterns: [
          { pattern: 'timeout', frequency: 4 },
          { pattern: 'flaky test', frequency: 2 },
        ],
      },
      lastUpdated: '2026-08-11T10:00:00Z',
    });

    const preferencesQuery = await store.query({ categories: ['preferences'] });
    expect(preferencesQuery).toHaveLength(1);
    expect(preferencesQuery[0]?.content).toContain('Known Failure Patterns');

    await store.write('codebase', {
      category: 'codebase',
      content: {
        projectName: 'test',
        lastUpdated: '2026-08-11T10:00:00Z',
        lastRunId: 'run-001',
        architecture: { summary: 'A'.repeat(1000), modules: [], patterns: [] },
        conventions: [],
      },
      lastUpdated: '2026-08-11T10:00:00Z',
    });

    const truncated = await store.query({ categories: ['codebase'], maxTokens: 1 });
    expect(truncated).toEqual([]);
  });

  it('throws ContextStoreInitError when initialization cannot create the project directory', async () => {
    const readOnlyDir = await mkdtemp(join(tmpdir(), 'ctx-ro-'));
    await chmod(readOnlyDir, 0o555);

    try {
      const readOnlyStore = new FilesystemProjectContextStore(readOnlyDir);
      await expect(readOnlyStore.initialize('/some/project')).rejects.toThrow(
        'Failed to initialize context store',
      );
    } finally {
      await chmod(readOnlyDir, 0o755);
      await rm(readOnlyDir, { recursive: true, force: true });
    }
  });
});
