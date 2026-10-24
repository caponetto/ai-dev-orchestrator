import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverRunManifest } from '../run-discovery';
import { getRunsDir } from '../workspace-paths';

vi.mock('../workspace-paths', async (original) => ({
  ...(await original<object>()),
  getRunsDir: vi.fn(),
}));
const execute = promisify(execFile);
const fixture = fileURLToPath(
  new URL('../../../workflow/test/fixtures/remote-completion-process.ts', import.meta.url),
);
interface Result {
  pid: number;
  state: string;
  refs: ArtifactRef[];
  inputTokens: number;
  outputTokens: number;
  dispatches: number;
  integrity: boolean[];
  locked: boolean;
  error?: string;
}
async function run(mode: string, root: string): Promise<Result> {
  const result = await execute(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), fixture, mode, root],
    { timeout: 30_000 },
  );
  return JSON.parse(result.stdout) as Result;
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe('remote completion across fresh processes', () => {
  it.each([
    'before-artifact',
    'after-artifact',
    'before-content',
    'after-content',
    'after-metadata',
    'after-inventory',
  ])(
    'recovers a hard exit %s without duplicate artifacts, dispatch or usage',
    async (window) => {
      const baselineRoot = await mkdtemp(join(tmpdir(), 'completion-baseline-'));
      const root = await mkdtemp(join(tmpdir(), 'completion-crash-'));
      try {
        const baseline = await run('baseline', baselineRoot);
        await expect(run(`crash-${window}`, root)).rejects.toMatchObject({ code: 73 });
        const recovered = await run('resume', root);
        expect(recovered).toMatchObject({
          state: 'DONE',
          refs: baseline.refs,
          inputTokens: 30,
          outputTokens: 20,
          dispatches: 1,
          integrity: [true],
          locked: false,
        });
      } finally {
        await Promise.all(
          [baselineRoot, root].map((dir) => rm(dir, { recursive: true, force: true })),
        );
      }
    },
    60_000,
  );

  it('inspection reconciles a failed final report with completed state and usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'completion-report-'));
    try {
      const result = await run('report-failure', root);
      expect(result).toMatchObject({
        state: 'DONE',
        inputTokens: 30,
        outputTokens: 20,
        dispatches: 1,
        error: expect.stringContaining('final manifest unavailable') as unknown,
      });
      vi.mocked(getRunsDir).mockReturnValue(root);
      expect(discoverRunManifest('remote-completion')).toMatchObject({
        status: 'completed',
        finalState: 'DONE',
        tokenUsage: { totalInputTokens: 30, totalOutputTokens: 20 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
