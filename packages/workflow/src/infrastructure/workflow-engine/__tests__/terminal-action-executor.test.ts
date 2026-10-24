import type { Action, ActionResult, EntryActionContinuation } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { executeTerminalActions } from '../terminal-action-executor';

const actions: Action[] = (['run_started', 'run_completed'] as const).map((event) => ({
  type: 'record_journal',
  params: { event },
}));
const success = (action = actions[0]): ActionResult => ({ action, success: true });

function fixture() {
  const calls: string[] = [];
  const cursors: EntryActionContinuation[] = [];
  const execute = vi.fn((action: Action) => {
    calls.push('execute');
    return Promise.resolve([success(action)]);
  });
  const effects = {
    execute,
    recordUsage: vi.fn(() => {
      calls.push('usage');
    }),
    persist: vi.fn((cursor: EntryActionContinuation) => {
      calls.push(`persist:${String(cursor.nextActionIndex)}`);
      cursors.push(structuredClone(cursor));
      return Promise.resolve();
    }),
    pauseForSession: vi.fn(() => Promise.resolve(false)),
    pauseForBudget: vi.fn(() => Promise.resolve(false)),
    shouldStop: vi.fn(() => false),
    deadlineExceeded: vi.fn(() => false),
  };
  return { calls, cursors, effects };
}

describe('terminal action execution', () => {
  it('resumes after completed work and records usage before committing the next cursor', async () => {
    const f = fixture();
    const completed = success();
    const result = await executeTerminalActions(
      'DONE',
      actions,
      { stateId: 'DONE', completedResults: [completed], nextActionIndex: 1 },
      f.effects,
    );
    expect(f.effects.execute).toHaveBeenCalledExactlyOnceWith(actions[1]);
    expect(f.calls).toEqual(['persist:1', 'execute', 'usage', 'persist:2']);
    expect(result.results).toEqual([completed, success(actions[1])]);
    expect(f.cursors.map((cursor) => cursor.completedResults.length)).toEqual([1, 2]);
  });

  it('does not dispatch when saving the initial cursor fails', async () => {
    const f = fixture();
    f.effects.persist.mockRejectedValueOnce(new Error('disk full'));
    await expect(executeTerminalActions('DONE', actions, null, f.effects)).rejects.toThrow(
      'disk full',
    );
    expect(f.effects.execute).not.toHaveBeenCalled();
  });

  it('does not dispatch another action if its completed predecessor cannot be checkpointed', async () => {
    const f = fixture();
    f.effects.persist.mockResolvedValueOnce().mockRejectedValueOnce(new Error('disk full'));
    await expect(executeTerminalActions('DONE', actions, null, f.effects)).rejects.toThrow(
      'disk full',
    );
    expect(f.effects.execute).toHaveBeenCalledTimes(1);
    expect(f.effects.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('retains an initial pending session without executing cleanup', async () => {
    const f = fixture();
    f.effects.pauseForSession.mockResolvedValueOnce(true);
    expect(await executeTerminalActions('DONE', actions, null, f.effects)).toEqual({
      results: [],
      pausedBeforeActions: true,
    });
    expect(f.effects.execute).not.toHaveBeenCalled();
  });

  it('retains a failed continuation for the controller to route to a failure terminal', async () => {
    const f = fixture();
    const failed = { ...success(), success: false };
    const result = await executeTerminalActions(
      'DONE',
      actions,
      { stateId: 'DONE', completedResults: [failed], nextActionIndex: 1 },
      f.effects,
    );
    expect(result.results).toEqual([failed]);
    expect(f.effects.execute).not.toHaveBeenCalled();
  });

  it.each(['failure', 'cancellation', 'deadline', 'budget', 'session'] as const)(
    'commits completed work and stops before another action after %s',
    async (stop) => {
      const f = fixture();
      if (stop === 'failure') {
        f.effects.execute.mockResolvedValueOnce([{ ...success(), success: false }]);
      }
      if (stop === 'cancellation') {
        f.effects.shouldStop.mockReturnValue(true);
      }
      if (stop === 'deadline') {
        f.effects.deadlineExceeded.mockReturnValue(true);
      }
      if (stop === 'budget') {
        f.effects.pauseForBudget.mockResolvedValueOnce(true);
      }
      if (stop === 'session') {
        f.effects.pauseForSession.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      }
      const result = await executeTerminalActions('DONE', actions, null, f.effects);
      expect(result.results).toHaveLength(1);
      expect(f.effects.execute).toHaveBeenCalledTimes(1);
      expect(f.cursors.at(-1)?.nextActionIndex).toBe(1);
      if (stop === 'failure') {
        expect(f.effects.deadlineExceeded).not.toHaveBeenCalled();
      }
    },
  );
});
