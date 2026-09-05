import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunManifest } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { DefaultManifestQuery } from '../default-manifest-query';

const TEST_DIR = join(tmpdir(), `manifest-query-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    runId: 'run-001',
    version: '1.0.0',
    repository: 'test-repo',
    workflow: { name: 'default', version: '1.0.0' },
    timing: {
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
      totalDurationMs: 3600000,
      stateTimings: [],
    },
    status: 'completed',
    finalState: 'DONE',
    activeRoles: [],
    artifactInventory: [],
    totalArtifacts: 0,
    totalArtifactSizeBytes: 0,
    iterations: [],
    governanceDecisions: 0,
    escalations: 0,
    humanInterventions: 0,
    agreements: [],
    tokenUsage: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, byRole: {} },
    ...overrides,
  };
}

function writeManifest(runId: string, manifest: RunManifest): void {
  const dir = join(TEST_DIR, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.yaml'), stringify(manifest), 'utf8');
}

describe('DefaultManifestQuery', () => {
  it('returns null for non-existent run', () => {
    const query = new DefaultManifestQuery(TEST_DIR);
    expect(query.get('missing')).toBeNull();
  });

  it('gets a manifest by runId', () => {
    const manifest = makeManifest({ runId: 'run-001' });
    writeManifest('run-001', manifest);

    const query = new DefaultManifestQuery(TEST_DIR);
    const result = query.get('run-001');

    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-001');
    expect(result?.status).toBe('completed');
  });

  it('lists all manifests without filter', () => {
    writeManifest('run-001', makeManifest({ runId: 'run-001' }));
    writeManifest('run-002', makeManifest({ runId: 'run-002' }));

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list();

    expect(results).toHaveLength(2);
  });

  it('filters by status', () => {
    writeManifest('run-001', makeManifest({ runId: 'run-001', status: 'completed' }));
    writeManifest('run-002', makeManifest({ runId: 'run-002', status: 'aborted' }));

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list({ status: 'completed' });

    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-001');
  });

  it('filters by repository', () => {
    writeManifest('run-001', makeManifest({ runId: 'run-001', repository: 'repo-a' }));
    writeManifest('run-002', makeManifest({ runId: 'run-002', repository: 'repo-b' }));

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list({ repository: 'repo-b' });

    expect(results).toHaveLength(1);
    expect(results[0].repository).toBe('repo-b');
  });

  it('filters by time range (after)', () => {
    writeManifest(
      'run-001',
      makeManifest({
        runId: 'run-001',
        timing: {
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T01:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      }),
    );
    writeManifest(
      'run-002',
      makeManifest({
        runId: 'run-002',
        timing: {
          startedAt: '2026-06-01T00:00:00Z',
          completedAt: '2026-06-01T01:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      }),
    );

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list({ after: '2026-03-01T00:00:00Z' });

    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-002');
  });

  it('filters by time range (before)', () => {
    writeManifest(
      'run-001',
      makeManifest({
        runId: 'run-001',
        timing: {
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T01:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      }),
    );
    writeManifest(
      'run-002',
      makeManifest({
        runId: 'run-002',
        timing: {
          startedAt: '2026-06-01T00:00:00Z',
          completedAt: '2026-06-01T01:00:00Z',
          totalDurationMs: 3600000,
          stateTimings: [],
        },
      }),
    );

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list({ before: '2026-03-01T00:00:00Z' });

    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-001');
  });

  it('returns empty list when base directory does not exist', () => {
    const query = new DefaultManifestQuery('/tmp/nonexistent-manifest-dir');
    expect(query.list()).toEqual([]);
  });

  it('skips directories without manifest file', () => {
    mkdirSync(join(TEST_DIR, 'run-empty'), { recursive: true });
    writeManifest('run-001', makeManifest({ runId: 'run-001' }));

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list();

    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-001');
  });

  it('skips corrupted manifest files', () => {
    writeManifest('run-001', makeManifest({ runId: 'run-001' }));
    const corruptDir = join(TEST_DIR, 'run-corrupt');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, 'manifest.yaml'), '{{invalid yaml', 'utf8');

    const query = new DefaultManifestQuery(TEST_DIR);
    const results = query.list();

    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe('run-001');
  });
});
