import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

import { discoverRunManifest } from '../run-discovery';
import { getRunsDir } from '../workspace-paths';

vi.mock('../workspace-paths', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAiDir: vi.fn(),
    getRunsDir: vi.fn(),
    getRunDir: vi.fn(),
    getDashboardLogPath: vi.fn(),
  };
});

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `ai-test-run-discovery-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('discoverRunManifest token reconciliation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    vi.mocked(getRunsDir).mockReturnValue(runsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('raises list totals from agent-stream usage when persisted tokens undercount', () => {
    const runId = '20260101-000000-stream1';
    const runsDir = getRunsDir();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, 'manifest.yaml'),
      stringify({
        runId,
        version: '1.0.0',
        repository: tmpDir,
        workflow: { name: 'dev', version: '1.0.0' },
        timing: {
          startedAt: '2026-01-01T10:00:00Z',
          completedAt: '2026-01-01T10:05:00Z',
          totalDurationMs: 300000,
          stateTimings: [],
        },
        status: 'completed',
        finalState: 'DONE',
        activeRoles: [
          {
            role: 'verifier',
            dispatches: 1,
            inputTokens: 1000,
            outputTokens: 100,
            totalDurationMs: 1000,
            artifactsProduced: 0,
          },
          {
            role: 'summary_writer',
            dispatches: 1,
            inputTokens: 0,
            outputTokens: 0,
            totalDurationMs: 90000,
            artifactsProduced: 0,
          },
        ],
        artifactInventory: [],
        totalArtifacts: 0,
        totalArtifactSizeBytes: 0,
        iterations: [],
        governanceDecisions: 0,
        escalations: 0,
        humanInterventions: 0,
        agreements: [],
        tokenUsage: {
          totalInputTokens: 1000,
          totalOutputTokens: 100,
          totalTokens: 1100,
          byRole: {
            verifier: { input: 1000, output: 100 },
            summary_writer: { input: 0, output: 0 },
          },
        },
      }),
    );

    const streamLines = [
      {
        runId,
        stateId: 'VERIFICATION',
        roleId: 'verifier',
        dispatchId: 'dispatch-1',
        timestamp: '2026-01-01T10:04:00Z',
        type: 'status',
        content: '',
        structuredData: { phase: 'usage_update', inputTokens: 1000, outputTokens: 100 },
      },
      {
        runId,
        stateId: 'WRAP_UP',
        roleId: 'summary_writer',
        dispatchId: 'dispatch-2',
        timestamp: '2026-01-01T10:05:00Z',
        type: 'status',
        content: '',
        structuredData: { phase: 'usage_update', inputTokens: 9000, outputTokens: 400 },
      },
    ];
    writeFileSync(
      join(runDir, 'agent-stream.jsonl'),
      `${streamLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );

    const manifest = discoverRunManifest(runId);
    expect(manifest).not.toBeNull();
    expect(manifest?.tokenUsage.totalInputTokens).toBe(10_000);
    expect(manifest?.tokenUsage.totalOutputTokens).toBe(500);
    expect(manifest?.tokenUsage.totalTokens).toBe(10_500);
    expect(manifest?.tokenUsage.byRole.summary_writer).toEqual({ input: 9000, output: 400 });

    const releaseRole = manifest?.activeRoles.find((r) => r.role === 'summary_writer');
    expect(releaseRole?.inputTokens).toBe(9000);
    expect(releaseRole?.outputTokens).toBe(400);
  });
});
