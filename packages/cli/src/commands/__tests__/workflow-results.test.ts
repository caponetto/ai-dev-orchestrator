import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import type { RunResult } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrchestrator, resumeOrchestrator } from '../../composition-root';
import { OutputFormatter } from '../../output/formatter';
import { answerCommand } from '../answer';
import { approveCommand } from '../approve';
import { resumeCommand } from '../resume';
import { retryCommand } from '../retry';
import { runCommand } from '../run';

const paths = vi.hoisted(() => ({ root: '' }));
vi.mock('../../workspace-paths', async (load) => ({
  ...(await load<object>()),
  getRunsDir: () => join(paths.root, 'runs'),
  getRunDir: () => join(paths.root, 'runs', 'run-result'),
}));
vi.mock('../../composition-root', () => ({
  createOrchestrator: vi.fn(),
  resumeOrchestrator: vi.fn(),
  createRunConfig: vi.fn(() => ({})),
  loadWorkflowFromConfig: vi.fn(() => ({ name: 'result-test', version: '1', states: {} })),
}));
vi.mock('../../intake-router', () => ({ resolveIntakeSources: vi.fn(() => []) }));

let stdout: string[];
let stderr: string[];
beforeEach(() => {
  paths.root = mkdtempSync(join(tmpdir(), 'cli-workflow-result-'));
  mkdirSync(join(paths.root, 'runs', 'run-result'), { recursive: true });
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(paths.root, { recursive: true, force: true });
});

const states = [
  { finalState: 'DONE', outcome: 'completed', exitCode: 0 },
  { finalState: 'FAILED', outcome: 'failed', exitCode: 3 },
  { finalState: 'ABORTED', outcome: 'aborted', exitCode: 4 },
  { finalState: 'WAITING_FOR_HUMAN', outcome: 'waiting', exitCode: 0 },
  { finalState: 'CUSTOM_STATE', outcome: 'returned', exitCode: 0 },
];
const commands = [
  'run',
  'resume',
  'retry',
  'approve',
  'reject',
  'answer',
  'session-answer',
] as const;

describe.each(commands)('%s workflow result contract', (command) => {
  it.each(states.flatMap((state) => [true, false].map((json) => ({ ...state, json }))))(
    'reports $finalState consistently (json=$json)',
    async ({ finalState, outcome, exitCode, json }) => {
      const result: RunResult = {
        runId: 'run-result',
        finalState,
        artifactInventory: [],
        manifest: {} as RunResult['manifest'],
      };
      const waitingContext = {
        requiredInput: command === 'session-answer' ? 'text' : 'approval',
        reason: 'waiting_for_human',
        requestingState: 'WORK',
        ...(command === 'session-answer'
          ? {
              liveSessionId: 'session-1',
              pendingRequestId: 'request-1',
              liveRequestType: 'clarification',
            }
          : {}),
      };
      const state = { currentState: 'WAITING_FOR_HUMAN', waitingContext };
      const execute = vi.fn().mockResolvedValue(result);
      const context = {
        runId: result.runId,
        runDir: join(paths.root, 'runs', result.runId),
        warnings: [],
        engine: { start: execute, resume: execute, retry: execute, getState: () => state },
        statePersistence: { load: () => state },
        journalWriter: { append: vi.fn() },
        artifactStore: { store: vi.fn() },
        liveRequestStore: { listPendingRequests: vi.fn().mockResolvedValue([]) },
      };
      vi.mocked(createOrchestrator).mockResolvedValue(context as never);
      vi.mocked(resumeOrchestrator).mockResolvedValue(context as never);
      vi.spyOn(DefaultStatePersistence.prototype, 'load').mockReturnValue(
        command === 'session-answer' ? (state as never) : null,
      );
      const formatter = new OutputFormatter({ json, noColor: true });
      const success = vi.spyOn(formatter, 'success');
      let code: number;
      if (command === 'run') {
        code = await runCommand(
          paths.root,
          { sources: ['test'], json, verbose: false, dryRun: false },
          formatter,
        );
      } else if (command === 'resume') {
        code = await resumeCommand(
          paths.root,
          { runId: result.runId, json, verbose: false },
          formatter,
        );
      } else if (command === 'retry') {
        code = await retryCommand(
          paths.root,
          { runId: result.runId, json, verbose: false },
          formatter,
        );
      } else if (command === 'approve' || command === 'reject') {
        code = await approveCommand(
          {
            runId: result.runId,
            reject: command === 'reject',
            message: null,
            json,
            verbose: false,
          },
          formatter,
        );
      } else {
        code = await answerCommand(
          {
            runId: result.runId,
            inputFile: null,
            messageId: null,
            answers: ['answer'],
            json,
            verbose: false,
          },
          formatter,
        );
      }

      expect(code).toBe(exitCode);
      expect(execute).toHaveBeenCalledOnce();
      if (json) {
        const records = stdout
          .join('')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(records).toContainEqual(
          expect.objectContaining({ runId: result.runId, finalState, outcome, exitCode }),
        );
        if (command === 'approve' || command === 'reject') {
          expect(records[0]).toMatchObject({
            status: command === 'reject' ? 'rejection' : 'approval',
            artifacts: 0,
          });
        }
        if (command === 'answer') {
          expect(records[0]).toMatchObject({
            status: 'answers_received',
          });
          expect(records[0]?.artifactPath).toBeTypeOf('string');
        }
        if (command === 'session-answer') {
          expect(records[0]).toMatchObject({
            status: 'session_clarification_answered',
            messageId: 'request-1',
          });
        }
      } else if (exitCode !== 0) {
        expect(stderr.join('')).toMatch(new RegExp(outcome, 'i'));
        expect(success).not.toHaveBeenCalled();
      } else if (finalState !== 'DONE') {
        expect(success).not.toHaveBeenCalled();
        expect(stdout.join('')).not.toContain('completed successfully');
      }
    },
  );
});
