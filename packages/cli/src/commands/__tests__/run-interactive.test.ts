import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type { LiveRequest } from '@ai-dev-orchestrator/runner';
import type { RunResult } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrchestrator } from '../../composition-root';
import { OutputFormatter } from '../../output/formatter';
import { runCommand } from '../run';

vi.mock('node:readline', () => ({ createInterface: vi.fn() }));
vi.mock('../../composition-root', () => ({
  createOrchestrator: vi.fn(),
  createRunConfig: vi.fn(() => ({})),
  loadWorkflowFromConfig: vi.fn(() => ({ name: 'test', version: '1' })),
  loadWorkflowByName: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const permission: LiveRequest = {
  runId: 'run',
  messageId: 'permission',
  kind: 'permission',
  createdAt: '',
  payload: { action: 'write', resource: 'file', riskLevel: 'low' },
};
let root: string;
let finish: ReturnType<typeof deferred<RunResult>>;
let running: Promise<number>;
let formatter: OutputFormatter;
let observed: ReturnType<typeof observe>;
function observe(output: OutputFormatter) {
  return {
    info: vi.spyOn(output, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(output, 'warn').mockImplementation(() => {}),
    success: vi.spyOn(output, 'success').mockImplementation(() => {}),
    summary: vi.spyOn(output, 'summary').mockImplementation(() => {}),
    spinner: vi.spyOn(output, 'startSpinner').mockImplementation(() => {}),
    clear: vi.spyOn(output, 'clearSpinner').mockImplementation(() => {}),
  };
}
let answer: (value: string) => void;
let store: {
  listPendingRequests: ReturnType<typeof vi.fn>;
  writeResponse: ReturnType<typeof vi.fn>;
};
let previousTTY: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  root = mkdtempSync(join(tmpdir(), 'run-interactive-'));
  previousTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  vi.mocked(createInterface)
    .mockReset()
    .mockImplementation(() => {
      const line = new EventEmitter();
      return Object.assign(line, {
        question: vi.fn((_question: string, callback: (value: string) => void) => {
          answer = callback;
        }),
        close: vi.fn(() => {
          line.emit('close');
        }),
      }) as unknown as ReturnType<typeof createInterface>;
    });
  store = {
    listPendingRequests: vi.fn().mockResolvedValue([permission]),
    writeResponse: vi.fn().mockResolvedValue('response_written'),
  };
  finish = deferred<RunResult>();
  vi.mocked(createOrchestrator).mockResolvedValue({
    runId: 'run',
    runDir: root,
    warnings: [],
    engine: { start: () => finish.promise },
    liveRequestStore: store,
    artifactStore: { store: vi.fn().mockResolvedValue({}) },
    journalWriter: { append: vi.fn() },
  } as never);
  formatter = new OutputFormatter({ noColor: true });
  observed = observe(formatter);
  running = runCommand(
    root,
    { sources: ['test'], verbose: false, json: false, dryRun: false },
    formatter,
  );
});
afterEach(async () => {
  finish.resolve({ runId: 'run', finalState: 'DONE', artifactInventory: [] } as never);
  await running;
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', { value: previousTTY, configurable: true });
  rmSync(root, { recursive: true, force: true });
});
describe('interactive run delivery', () => {
  it('waits for strict storage acknowledgement before reporting a stored permission', async () => {
    const write = deferred<'response_written'>();
    store.writeResponse.mockReturnValue(write.promise);
    await vi.advanceTimersByTimeAsync(1000);
    answer('y');
    expect(observed.info).not.toHaveBeenCalledWith('Approved.');
    expect(store.writeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'permission', payload: { granted: true } }),
      { requireRequest: true },
    );
    write.resolve('response_written');
    await vi.advanceTimersByTimeAsync(0);
    expect(observed.info).toHaveBeenCalledWith(expect.stringContaining('response stored'));
  });
  it('opens only one terminal reader for multiple pending requests', async () => {
    store.listPendingRequests.mockResolvedValue([
      permission,
      { ...permission, messageId: 'second' },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(createInterface).toHaveBeenCalledTimes(1);
  });
  it('recognizes the full word no as a denial', async () => {
    await vi.advanceTimersByTimeAsync(1000);
    answer('no');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { granted: false } }),
      expect.anything(),
    );
  });
  it('does not overlap polls while storage reads are slow', async () => {
    const read = deferred<readonly LiveRequest[]>();
    store.listPendingRequests.mockReturnValue(read.promise);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.listPendingRequests).toHaveBeenCalledTimes(1);
    read.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
  });
  it('reoffers a pending request after a failed write', async () => {
    const failed = Promise.reject(new Error('disk unavailable'));
    void failed.catch(() => {});
    store.writeResponse.mockReturnValueOnce(failed);
    await vi.advanceTimersByTimeAsync(1000);
    answer('yes');
    await vi.advanceTimersByTimeAsync(1000);
    expect(createInterface).toHaveBeenCalledTimes(2);
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('disk unavailable'));
  });
});
