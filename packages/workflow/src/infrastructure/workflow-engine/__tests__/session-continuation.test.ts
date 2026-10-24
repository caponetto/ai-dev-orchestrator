/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods without invoking them. */
import { createRunId } from '@ai-dev-orchestrator/ports';
import type {
  ActionResult,
  AgentSessionHandle,
  PersistedWaitingContext,
} from '@ai-dev-orchestrator/schemas';
import { createMockArtifactStore } from '@ai-dev-orchestrator/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  completeSessionAction,
  createSessionCompletion,
  resumeLiveSession,
  refreshSessionRequest,
} from '../session-continuation';

const handle: AgentSessionHandle = {
  ref: { sessionId: 'session', runId: 'run', stateId: 'WORK', role: 'planner', transport: 'stdio' },
  state: 'awaiting_human',
  pendingRequests: [
    {
      requestId: 'fallback',
      kind: 'permission',
      createdAt: '2026-10-23T00:00:00Z',
      payload: { action: 'file_write', resource: '/repo/file' },
    },
    {
      requestId: 'request',
      kind: 'permission',
      createdAt: '2026-10-23T00:00:00Z',
      payload: { action: 'file_write', resource: '/repo/saved' },
    },
  ],
};
const waiting: PersistedWaitingContext = {
  reason: 'live_session_awaiting_human',
  requiredInput: 'approval',
  requestingState: 'WORK',
  autoResumeSafe: false,
  presentedArtifacts: [],
  waitingSince: '2026-10-23T00:00:00Z',
  liveSessionId: 'session',
  pendingRequestId: 'request',
  sessionTransport: 'stdio',
};
const snapshot = {
  ...handle,
  lastProtocolTimestamp: '2026-10-23T00:00:00Z',
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};

function fixture() {
  const attach = vi.fn().mockResolvedValue(handle);
  const getSnapshot = vi.fn().mockResolvedValue(null);
  const sendHumanResponse = vi.fn().mockResolvedValue(true);
  const waitForAdvance = vi
    .fn()
    .mockResolvedValue({ kind: 'completed', artifactContent: '{}', durationMs: 10 });
  const append = vi.fn();
  const context: Parameters<typeof resumeLiveSession>[3] = {
    supervisor: { attach, getSnapshot, sendHumanResponse, waitForAdvance },
    journalWriter: { append, appendBatch: vi.fn() },
    runId: createRunId('run'),
    getStateId: () => 'WAITING_FOR_HUMAN',
    isAborted: () => false,
  };
  return { attach, getSnapshot, sendHumanResponse, waitForAdvance, append, context };
}

describe('session continuation', () => {
  it.each(['runId', 'sessionId', 'stateId', 'role'] as const)(
    'rejects an attachment with the wrong %s before delivering a response',
    async (field) => {
      const f = fixture();
      f.attach.mockResolvedValueOnce({ ...handle, ref: { ...handle.ref, [field]: 'unrelated' } });
      await expect(
        resumeLiveSession(waiting, { type: 'approval', content: 'yes' }, 'session', {
          ...f.context,
          expectedRef: handle.ref,
        }),
      ).rejects.toThrow('identity');
      expect(f.sendHumanResponse).not.toHaveBeenCalled();
      expect(f.append).not.toHaveBeenCalled();
    },
  );

  it('refreshes a nested session request without replacing a different top-level or peer request', () => {
    const next = { ...handle.pendingRequests[0], requestId: 'next' };
    const other = { ...handle.ref, sessionId: 'other' };
    const result: ActionResult = {
      action: { type: 'dispatch_parallel_workers', params: { roles: ['planner'] } },
      success: true,
      sessionRef: other,
      pendingRequest: handle.pendingRequests[0],
      workerResults: [
        {
          role: 'planner',
          success: true,
          sessionRef: handle.ref,
          pendingRequest: handle.pendingRequests[0],
        },
        {
          role: 'planner',
          success: true,
          sessionRef: other,
          pendingRequest: handle.pendingRequests[0],
        },
      ],
    };
    const updated = refreshSessionRequest(result, 'session', next);
    expect(updated.pendingRequest).toBe(result.pendingRequest);
    expect(updated.workerResults?.[0].pendingRequest).toEqual(next);
    expect(updated.workerResults?.[1]).toBe(result.workerResults?.[1]);
    expect(result.workerResults?.[0].pendingRequest?.requestId).toBe('fallback');
  });

  it('reports refused delivery without advancing or redirecting the answer', async () => {
    const f = fixture();
    f.sendHumanResponse.mockResolvedValue(false);
    await expect(
      resumeLiveSession(waiting, { type: 'approval', content: 'yes' }, 'session', f.context),
    ).rejects.toThrow('not delivered');
    expect(f.sendHumanResponse).toHaveBeenCalledExactlyOnceWith('session', 'request', {
      granted: true,
      reason: 'yes',
    });
    expect(f.waitForAdvance).not.toHaveBeenCalled();
  });

  it.each(['running', 'completed', 'failed', 'aborted'] as const)(
    'does not replay an approval when the attached session is already %s without pending requests',
    async (state) => {
      const f = fixture();
      f.attach.mockResolvedValueOnce({ ...handle, state, pendingRequests: [] });
      await resumeLiveSession(
        waiting,
        { type: 'approval', content: 'old answer' },
        'session',
        f.context,
      );
      expect(f.sendHumanResponse).not.toHaveBeenCalled();
      expect(f.waitForAdvance).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['approval', { granted: true, reason: 'response' }],
    ['rejection', { granted: false, reason: 'response' }],
    ['text', { answer: 'response' }],
  ] as const)(
    'routes %s to the saved request before waiting for advancement',
    async (type, payload) => {
      const f = fixture();
      expect(
        await resumeLiveSession(waiting, { type, content: 'response' }, 'session', f.context),
      ).toMatchObject({ kind: 'advanced', handle });
      expect(f.sendHumanResponse).toHaveBeenCalledExactlyOnceWith('session', 'request', payload);
      expect(f.append).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'human_input_received',
          data: expect.objectContaining({
            stateId: 'WAITING_FOR_HUMAN',
            sessionId: 'session',
          }) as unknown,
        }),
      );
      expect(f.sendHumanResponse.mock.invocationCallOrder[0]).toBeLessThan(
        f.waitForAdvance.mock.invocationCallOrder[0],
      );
    },
  );

  it('uses a pending request from a legacy attached handle and tolerates no pending request', async () => {
    const f = fixture();
    await resumeLiveSession(
      { ...waiting, pendingRequestId: undefined },
      { type: 'approval', content: '' },
      'session',
      f.context,
    );
    expect(f.sendHumanResponse).toHaveBeenCalledWith('session', 'fallback', expect.any(Object));
    f.sendHumanResponse.mockClear();
    f.attach.mockResolvedValueOnce({ ...handle, pendingRequests: [] });
    await resumeLiveSession(
      { ...waiting, pendingRequestId: undefined },
      { type: 'approval', content: '' },
      'session',
      f.context,
    );
    expect(f.sendHumanResponse).not.toHaveBeenCalled();
  });

  it.each(['attach', 'snapshot', 'response', 'advance'] as const)(
    'stops after cancellation during %s I/O',
    async (stage) => {
      const f = fixture();
      let aborted = false;
      if (stage === 'attach') {
        f.attach.mockImplementationOnce(() => {
          aborted = true;
          return Promise.resolve(handle);
        });
      }
      if (stage === 'snapshot') {
        f.attach.mockResolvedValueOnce(null);
        f.getSnapshot.mockImplementationOnce(() => {
          aborted = true;
          return Promise.resolve(snapshot);
        });
      }
      if (stage === 'response') {
        f.sendHumanResponse.mockImplementationOnce(() => {
          aborted = true;
          return Promise.resolve(true);
        });
      }
      if (stage === 'advance') {
        f.waitForAdvance.mockImplementationOnce(() => {
          aborted = true;
          return Promise.resolve({ kind: 'completed', durationMs: 10 });
        });
      }
      expect(
        await resumeLiveSession(waiting, { type: 'approval', content: '' }, 'session', {
          ...f.context,
          isAborted: () => aborted,
        }),
      ).toEqual({ kind: 'interrupted' });
      if (stage !== 'advance') {
        expect(f.waitForAdvance).not.toHaveBeenCalled();
      }
      if (stage === 'attach' || stage === 'snapshot') {
        expect(f.sendHumanResponse).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['stdio', 'remote', undefined] as const)(
    'reports an unreachable %s session without changing workflow state',
    async (transport) => {
      const f = fixture();
      f.attach.mockResolvedValueOnce(null);
      f.getSnapshot.mockResolvedValueOnce(snapshot);
      const result = await resumeLiveSession(
        { ...waiting, sessionTransport: transport },
        { type: 'approval', content: '' },
        'session',
        f.context,
      );
      expect(result.kind).toBe('unreachable');
      expect(f.sendHumanResponse).not.toHaveBeenCalled();
      expect(f.append).not.toHaveBeenCalled();
    },
  );
});

describe('session completion artifacts', () => {
  it('stores completed output and retains usage for accounting by the controller', async () => {
    const store = createMockArtifactStore();
    const result = await createSessionCompletion(
      'planner',
      {
        kind: 'completed',
        artifactContent: '{}',
        durationMs: 12,
        tokenUsage: { inputTokens: 30, outputTokens: 20 },
      },
      'plan',
      store,
      createRunId('run'),
    );
    expect(result).toMatchObject({
      success: true,
      artifactRef: { type: 'plan' },
      usageSnapshot: {
        totalInputTokens: 30,
        totalOutputTokens: 20,
        byRole: { planner: { inputTokens: 30, outputTokens: 20, durationMs: 12 } },
      },
    });
  });

  it.each(['contract', 'output', 'storage'] as const)(
    'returns an action failure for missing %s without dropping reported usage',
    async (failure) => {
      const store = createMockArtifactStore();
      if (failure === 'storage') {
        vi.mocked(store.store).mockRejectedValueOnce('disk full');
      }
      const result = await createSessionCompletion(
        'planner',
        {
          kind: 'completed',
          artifactContent: failure === 'output' ? undefined : '{}',
          durationMs: 12,
          tokenUsage: { inputTokens: 30, outputTokens: 20 },
        },
        failure === 'contract' ? undefined : 'plan',
        store,
        createRunId('run'),
      );
      expect(result).toMatchObject({
        success: false,
        error: expect.any(String) as unknown,
        usageSnapshot: { totalInputTokens: 30, totalOutputTokens: 20 },
      });
    },
  );

  it('leaves usage absent when the session did not report it', async () => {
    const result = await createSessionCompletion(
      'planner',
      { kind: 'completed', artifactContent: '{}', durationMs: 12 },
      'plan',
      createMockArtifactStore(),
      createRunId('run'),
    );
    expect(result.usageSnapshot).toBeUndefined();
  });
});

describe('parallel completion replacement', () => {
  it('keeps peer identity and forwards the updated batch for dynamic aggregation without mutating the original', async () => {
    const completion: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'planner' } },
      success: true,
      artifactRef: { type: 'plan', name: 'plan', version: 1, checksum: 'abc' },
    };
    const original: ActionResult = {
      action: { type: 'dispatch_parallel_workers', params: { roles: ['planner', 'implementer'] } },
      success: true,
      workerResults: [
        {
          role: 'planner',
          success: true,
          sessionOutcome: 'awaiting_human',
          sessionRef: handle.ref,
        },
        {
          role: 'implementer',
          success: true,
          sessionOutcome: 'awaiting_human',
          sessionRef: { ...handle.ref, role: 'implementer', sessionId: 'peer' },
          pendingRequest: {
            requestId: 'peer-request',
            kind: 'permission',
            createdAt: '',
            payload: { action: 'file_write', resource: '/repo/peer' },
          },
        },
      ],
    };
    const finalize = vi.fn((result: ActionResult) => Promise.resolve(result));
    const result = await completeSessionAction(original, 'session', completion, finalize);
    expect(result).toMatchObject({
      sessionOutcome: 'awaiting_human',
      sessionRef: { sessionId: 'peer' },
      artifactRefs: [completion.artifactRef],
    });
    expect(result.workerResults?.[0]).toMatchObject({
      artifactRef: completion.artifactRef,
      sessionOutcome: 'completed',
    });
    expect(original.workerResults?.[0]?.sessionOutcome).toBe('awaiting_human');
    expect(finalize).toHaveBeenCalledExactlyOnceWith(result);
  });

  it('completes a single action without attempting aggregation', async () => {
    const completion: ActionResult = {
      action: { type: 'dispatch_worker', params: { role: 'planner' } },
      success: false,
      error: 'failed',
    };
    const finalize = vi.fn();
    expect(await completeSessionAction(completion, 'session', completion, finalize)).toBe(
      completion,
    );
    expect(finalize).not.toHaveBeenCalled();
  });
});
