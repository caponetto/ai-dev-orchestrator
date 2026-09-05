import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunManifest } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { FilesystemManifestWriter } from '../filesystem-manifest-writer';

const TEST_DIR = join(tmpdir(), `manifest-writer-test-${String(Date.now())}`);

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

describe('FilesystemManifestWriter', () => {
  it('writes manifest.yaml to the run directory', () => {
    const writer = new FilesystemManifestWriter(TEST_DIR);
    const manifest = makeManifest({ runId: 'run-001' });

    writer.write('run-001', manifest);

    const filePath = join(TEST_DIR, 'run-001', 'manifest.yaml');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf8');
    const parsed = parse(content) as RunManifest;
    expect(parsed.runId).toBe('run-001');
    expect(parsed.status).toBe('completed');
  });

  it('creates run directory if it does not exist', () => {
    const writer = new FilesystemManifestWriter(TEST_DIR);
    const manifest = makeManifest({ runId: 'run-new' });

    writer.write('run-new', manifest);

    expect(existsSync(join(TEST_DIR, 'run-new', 'manifest.yaml'))).toBe(true);
  });

  it('overwrites existing manifest', () => {
    const writer = new FilesystemManifestWriter(TEST_DIR);
    writer.write('run-001', makeManifest({ runId: 'run-001', status: 'completed' }));
    writer.write('run-001', makeManifest({ runId: 'run-001', status: 'aborted' }));

    const content = readFileSync(join(TEST_DIR, 'run-001', 'manifest.yaml'), 'utf8');
    const parsed = parse(content) as RunManifest;
    expect(parsed.status).toBe('aborted');
  });

  it('roundtrips with DefaultManifestQuery', async () => {
    const { DefaultManifestQuery } = await import('../default-manifest-query');

    const writer = new FilesystemManifestWriter(TEST_DIR);
    const manifest = makeManifest({ runId: 'run-roundtrip', totalArtifacts: 5 });

    writer.write('run-roundtrip', manifest);

    const query = new DefaultManifestQuery(TEST_DIR);
    const read = query.get('run-roundtrip');

    expect(read).not.toBeNull();
    expect(read?.runId).toBe('run-roundtrip');
    expect(read?.totalArtifacts).toBe(5);
  });
});
