import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const fixture = fileURLToPath(new URL('../../test/fixtures/recovery-process.mjs', import.meta.url));

interface ProcessResult {
  pid: number;
  finalState: string;
  refs: ArtifactRef[];
  inputTokens: number;
  outputTokens: number;
  stateHistory: string[];
  pendingTerminalState?: string;
  waitingContext?: unknown;
  repoRoot: string;
  lock: { exists: boolean };
  integrity: boolean[];
  dispatches: number;
}

async function run(mode: string, root: string): Promise<ProcessResult> {
  const result = await execute(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), fixture, mode, root],
    { timeout: 20_000 },
  );
  return JSON.parse(result.stdout) as ProcessResult;
}

describe('fresh-process recovery with a real CLI subprocess', () => {
  it('recovers journal-ahead cleanup after a hard exit without repeating work or usage', async () => {
    const baselineRoot = mkdtempSync(join(tmpdir(), 'process-baseline-'));
    const crashRoot = mkdtempSync(join(tmpdir(), 'process-crash-'));
    try {
      await Promise.all(
        [baselineRoot, crashRoot].map((root) => execute('git', ['init', '--quiet', root])),
      );
      const baseline = await run('baseline', baselineRoot);
      await expect(run('crash', crashRoot)).rejects.toMatchObject({ code: 73 });
      const persistence = new DefaultStatePersistence(crashRoot);
      const checkpoint = persistence.load(createRunId('fresh-process'));
      expect(checkpoint?.entryActionContinuation?.nextActionIndex).not.toBe(1);
      expect(persistence.probeLock(createRunId('fresh-process'))).toMatchObject({
        exists: true,
        pidRunning: false,
      });
      const crashedPid = Number(readFileSync(join(crashRoot, 'crashed-pid'), 'utf8'));
      const recovered = await run('resume', crashRoot);
      expect(recovered.pid).not.toBe(crashedPid);
      expect(recovered).toMatchObject({
        finalState: 'DONE',
        refs: baseline.refs,
        inputTokens: 30,
        outputTokens: 20,
        stateHistory: baseline.stateHistory,
        repoRoot: crashRoot,
        lock: { exists: false },
        integrity: [true, true, true],
        dispatches: 1,
      });
      expect(recovered.pendingTerminalState).toBeUndefined();
      expect(recovered.waitingContext).toBeUndefined();
      expect(baseline.dispatches).toBe(1);
    } finally {
      rmSync(baselineRoot, { recursive: true, force: true });
      rmSync(crashRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('restores a human gate in a new process without repeating the worker or charging usage twice', async () => {
    const baselineRoot = mkdtempSync(join(tmpdir(), 'gate-baseline-'));
    const pausedRoot = mkdtempSync(join(tmpdir(), 'gate-paused-'));
    try {
      await Promise.all(
        [baselineRoot, pausedRoot].map((root) => execute('git', ['init', '--quiet', root])),
      );
      const baseline = await run('complete-wait', baselineRoot);
      const paused = await run('pause-wait', pausedRoot);
      expect(paused).toMatchObject({
        finalState: 'WAITING_FOR_HUMAN',
        dispatches: 1,
        lock: { exists: false },
        waitingContext: { requestingState: 'WORK', requiredInput: 'approval' },
      });
      const recovered = await run('resume-wait', pausedRoot);
      expect(recovered.pid).not.toBe(paused.pid);
      expect(recovered).toMatchObject({
        finalState: 'DONE',
        refs: baseline.refs,
        stateHistory: baseline.stateHistory,
        inputTokens: 30,
        outputTokens: 20,
        dispatches: 1,
        lock: { exists: false },
      });
      expect(recovered.waitingContext).toBeUndefined();
    } finally {
      rmSync(baselineRoot, { recursive: true, force: true });
      rmSync(pausedRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
