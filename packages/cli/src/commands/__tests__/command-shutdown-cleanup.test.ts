import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrchestrator, loadWorkflowByName, resumeOrchestrator } from '../../composition-root';
import { OutputFormatter } from '../../output/formatter';
import { answerCommand } from '../answer';
import { approveCommand } from '../approve';
import { permitCommand } from '../permit';
import { resumeCommand } from '../resume';
import { retryCommand } from '../retry';
import { runCommand } from '../run';

const selected = vi.hoisted(() => ({ root: '', state: null as Record<string, unknown> | null }));
vi.mock('../../composition-root', () => ({
  createOrchestrator: vi.fn(),
  resumeOrchestrator: vi.fn(),
  createRunConfig: vi.fn(() => ({})),
  loadWorkflowByName: vi.fn(),
  loadWorkflowFromConfig: vi.fn(() => ({ name: 'test', version: '1' })),
}));
vi.mock('../../workspace-paths', () => ({
  getRunDir: () => selected.root,
  getRunsDir: () => selected.root,
  getArtifactsDir: () => join(selected.root, 'artifacts'),
  getConfigSnapshotPath: () => join(selected.root, 'config-snapshot.json'),
  getJournalPath: () => join(selected.root, 'journal.jsonl'),
}));
vi.mock('@ai-dev-orchestrator/core', async (load) => {
  const actual = await load<object>();
  return {
    ...actual,
    DefaultStatePersistence: class {
      load() {
        return selected.state;
      }
      reconstructFromJournal() {
        return null;
      }
    },
  };
});
let shutdown: ShutdownCoordinator;
function observeUninstall(coordinator: ShutdownCoordinator) {
  return vi.spyOn(coordinator, 'uninstall');
}
let uninstall: ReturnType<typeof observeUninstall>;
let execute: ReturnType<typeof vi.fn>;
let formatter: OutputFormatter;
const commands = [
  'run',
  'resume',
  'retry',
  'approve',
  'permit',
  'answer-session',
  'answer-persisted',
] as const;
type Command = (typeof commands)[number];
function invoke(command: Command, extra: { dryRun?: boolean; workflow?: string } = {}) {
  const common = { runId: 'run', json: true, verbose: false };
  if (command === 'run') {
    return runCommand(
      selected.root,
      { sources: ['test'], dryRun: false, ...common, ...extra },
      formatter,
    );
  }
  if (command === 'resume') {
    return resumeCommand(selected.root, common, formatter);
  }
  if (command === 'retry') {
    return retryCommand(selected.root, common, formatter);
  }
  if (command === 'approve') {
    return approveCommand({ ...common, reject: false, message: null }, formatter);
  }
  if (command === 'permit') {
    return permitCommand({ ...common, deny: false, messageId: 'request' }, formatter);
  }
  return answerCommand(
    { ...common, messageId: null, inputFile: null, answers: ['answer'] },
    formatter,
  );
}
beforeEach(() => {
  selected.root = mkdtempSync(join(tmpdir(), 'command-shutdown-'));
  selected.state = {
    currentState: 'WAITING_FOR_HUMAN',
    waitingContext: { requiredInput: 'approval', requestingState: 'WORK', waitingSince: 'wait' },
  };
  shutdown = new ShutdownCoordinator({} as never, {} as never);
  shutdown.install();
  uninstall = observeUninstall(shutdown);
  execute = vi
    .fn()
    .mockResolvedValue({ runId: 'run', finalState: 'DONE', artifactInventory: [], manifest: {} });
  const context = {
    engine: { start: execute, resume: execute, retry: execute, getState: () => selected.state },
    runId: 'run',
    runDir: selected.root,
    warnings: [],
    shutdownCoordinator: shutdown,
    statePersistence: { load: () => selected.state, reconstructFromJournal: () => null },
    journalReader: { readAll: () => [] },
    artifactStore: { store: vi.fn().mockResolvedValue({}) },
    journalWriter: { append: vi.fn() },
    liveRequestStore: { listPendingRequests: vi.fn().mockResolvedValue([]) },
  };
  vi.mocked(createOrchestrator).mockResolvedValue(context as never);
  vi.mocked(resumeOrchestrator).mockResolvedValue(context as never);
  formatter = new OutputFormatter({ json: true });
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});
afterEach(() => {
  shutdown.uninstall();
  vi.restoreAllMocks();
  rmSync(selected.root, { recursive: true, force: true });
});
describe('CLI command shutdown resource ownership', () => {
  it.each(commands.flatMap((command) => [true, false].map((success) => ({ command, success }))))(
    'cleans handlers after $command (success=$success)',
    async ({ command, success }) => {
      if (command === 'permit' || command === 'answer-session') {
        selected.state = {
          currentState: 'WAITING_FOR_HUMAN',
          waitingContext: {
            liveSessionId: 'session',
            liveRequestType: command === 'permit' ? 'permission' : 'clarification',
            pendingRequestId: 'request',
          },
        };
      }
      if (command === 'answer-persisted') {
        selected.state = {
          currentState: 'WAITING_FOR_HUMAN',
          waitingContext: { requiredInput: 'text', requestingState: 'WORK', waitingSince: 'wait' },
        };
      }
      if (!success) {
        execute.mockRejectedValueOnce(new Error('execution failed'));
      }
      expect(await invoke(command)).toBe(success ? 0 : 3);
      expect(uninstall).toHaveBeenCalledOnce();
    },
  );
  it.each(['dry-run', 'unknown-workflow'] as const)(
    'cleans resources after run validation: %s',
    async (mode) => {
      vi.mocked(loadWorkflowByName).mockReturnValueOnce(null);
      expect(
        await invoke('run', mode === 'dry-run' ? { dryRun: true } : { workflow: 'missing' }),
      ).toBe(mode === 'dry-run' ? 0 : 64);
      expect(execute).not.toHaveBeenCalled();
      expect(uninstall).toHaveBeenCalledOnce();
    },
  );
  it.each(['resume-missing', 'resume-text', 'answer-wrong-wait'] as const)(
    'cleans resources after restored context validation: %s',
    async (mode) => {
      selected.state =
        mode === 'resume-missing'
          ? null
          : {
              currentState: 'WAITING_FOR_HUMAN',
              waitingContext: { requiredInput: mode === 'resume-text' ? 'text' : 'approval' },
            };
      expect(await invoke(mode === 'answer-wrong-wait' ? 'answer-persisted' : 'resume')).toBe(
        mode === 'resume-missing' ? 1 : 64,
      );
      expect(execute).not.toHaveBeenCalled();
      expect(uninstall).toHaveBeenCalledOnce();
    },
  );
});
