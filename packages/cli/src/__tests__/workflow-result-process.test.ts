import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/workflow-result-process.mjs', import.meta.url),
);
const outcomes = [
  { target: 'DONE', outcome: 'completed', code: 0 },
  { target: 'FAILED', outcome: 'failed', code: 3 },
  { target: 'ABORTED', outcome: 'aborted', code: 4 },
  { target: 'WAITING_FOR_HUMAN', outcome: 'waiting', code: 0 },
];
describe.each(['approve', 'reject', 'answer', 'resume', 'retry'])(
  '%s real CLI exit status',
  (command) => {
    it.each(outcomes)(
      'matches returned $target state and JSON',
      async ({ target, outcome, code }) => {
        const root = mkdtempSync(join(tmpdir(), 'workflow-result-process-'));
        try {
          const observed = await new Promise<{ code: number; stdout: string; stderr: string }>(
            (resolve, reject) => {
              execFile(
                process.execPath,
                ['--import', import.meta.resolve('tsx'), fixture, root, command, target],
                { timeout: 20_000 },
                (error, stdout, stderr) => {
                  if (error && (typeof error.code !== 'number' || error.killed || error.signal)) {
                    reject(new Error('CLI process could not finish normally', { cause: error }));
                    return;
                  }
                  resolve({
                    code: typeof error?.code === 'number' ? error.code : 0,
                    stdout,
                    stderr,
                  });
                },
              );
            },
          );
          expect(observed.code, observed.stderr).toBe(code);
          const records = observed.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
          expect(records).toContainEqual(
            expect.objectContaining({
              runId: 'workflow-result',
              finalState: target,
              outcome,
              exitCode: code,
            }),
          );
          const persistence = new DefaultStatePersistence(join(root, '.ai', 'runs'));
          expect(persistence.load(createRunId('workflow-result'))?.currentState).toBe(target);
          expect(persistence.probeLock(createRunId('workflow-result')).exists).toBe(false);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
      30_000,
    );
  },
);
