import type { AgentSessionSupervisor, RunnerSystem } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { AgentSessionSnapshot } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { cancelWorkflowExecution } from '../workflow-cancellation';

const runId = createRunId('run');
function snapshot(id: string, state = 'running', run = 'run') {
  return { ref: { sessionId: id, runId: run }, state } as AgentSessionSnapshot;
}
describe('workflow cancellation fanout', () => {
  it('cancels workers without a supervisor', async () => {
    const cancelAllWorkers = vi.fn().mockResolvedValue(undefined);
    await cancelWorkflowExecution(
      { cancelAllWorkers } as unknown as RunnerSystem,
      undefined,
      runId,
      'signal',
    );
    expect(cancelAllWorkers).toHaveBeenCalledOnce();
  });
  it('aborts each live session for this run once, even when another abort fails', async () => {
    const cancelAllWorkers = vi.fn().mockRejectedValue(new Error('worker failure'));
    const abort = vi
      .fn()
      .mockRejectedValueOnce(new Error('session failure'))
      .mockResolvedValue(true);
    const supervisor = {
      abort,
      listByRun: vi
        .fn()
        .mockResolvedValue([
          snapshot('first'),
          snapshot('first'),
          snapshot('second', 'awaiting_human'),
          snapshot('done', 'completed'),
          snapshot('failed', 'failed'),
          snapshot('aborted', 'aborted'),
          snapshot('foreign', 'running', 'other'),
        ]),
    } as unknown as AgentSessionSupervisor;
    await cancelWorkflowExecution(
      { cancelAllWorkers } as unknown as RunnerSystem,
      supervisor,
      runId,
      'shutdown',
    );
    expect(cancelAllWorkers).toHaveBeenCalledOnce();
    expect(abort.mock.calls).toEqual([
      ['first', 'shutdown'],
      ['second', 'shutdown'],
    ]);
  });
  it('does not let a failed session catalog prevent worker cancellation', async () => {
    const cancelAllWorkers = vi.fn().mockResolvedValue(undefined);
    const supervisor = {
      listByRun: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
    } as unknown as AgentSessionSupervisor;
    await expect(
      cancelWorkflowExecution(
        { cancelAllWorkers } as unknown as RunnerSystem,
        supervisor,
        runId,
        'shutdown',
      ),
    ).resolves.toBeUndefined();
    expect(cancelAllWorkers).toHaveBeenCalledOnce();
  });
  it('starts session cancellation even while worker cancellation is still unresolved', async () => {
    let resolve!: () => void;
    const cancelAllWorkers = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const abort = vi.fn().mockResolvedValue(true);
    const supervisor = {
      abort,
      listByRun: vi.fn().mockResolvedValue([snapshot('session')]),
    } as unknown as AgentSessionSupervisor;
    const cancelling = cancelWorkflowExecution(
      { cancelAllWorkers } as unknown as RunnerSystem,
      supervisor,
      runId,
      'shutdown',
    );
    await vi.waitFor(() => {
      expect(abort).toHaveBeenCalledWith('session', 'shutdown');
    });
    resolve();
    await cancelling;
  });
});
