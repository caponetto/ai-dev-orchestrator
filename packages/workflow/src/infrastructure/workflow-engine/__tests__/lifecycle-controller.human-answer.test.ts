/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock port methods. */
import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import { createRunId } from '@ai-dev-orchestrator/ports';
import type { HumanInput, PersistedState, WorkflowRunConfig } from '@ai-dev-orchestrator/schemas';
import {
  createMockArtifactStore,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '@ai-dev-orchestrator/test-utils';
import { assert, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

function fixture(overrides: Partial<PersistedState> = {}) {
  const artifactStore = createMockArtifactStore();
  const statePersistence = createMockStatePersistence();
  const journalWriter = createMockJournalWriter();
  const governanceEngine = createMockGovernance();
  const config: WorkflowRunConfig = {
    runId: createRunId('answer'),
    sources: [],
    governancePolicy: {},
    roleAssignments: {},
    workflowDefinition: {
      name: 'answer',
      version: '1',
      initialState: 'WORK',
      terminalStates: ['DONE'],
      states: {
        WORK: {
          type: 'action',
          description: '',
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              priority: 0,
              governanceRequired: false,
            },
          ],
        },
        WAIT: {
          type: 'wait',
          description: '',
          exitActions: [
            { type: 'store_artifact', params: { type: 'plan', name: 'exit', content: '{}' } },
          ],
          transitions: [
            {
              target: 'DONE',
              trigger: 'human_input',
              guards: [],
              priority: 0,
              governanceRequired: false,
            },
          ],
        },
        DONE: { type: 'terminal', description: '', transitions: [] },
      },
    },
  };
  const state: PersistedState = {
    runId: createRunId(config.runId),
    schemaVersion: 2,
    currentState: 'WAIT',
    previousState: 'WORK',
    stateEnteredAt: '',
    transitionCount: 1,
    stateHistory: ['WORK', 'WAIT'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'answer',
    workflowVersion: '1',
    persistedAt: '',
    persistenceVersion: 1,
    checksum: '',
    waitingContext: {
      reason: 'clarification_needed',
      requiredInput: 'text',
      requestingState: 'WORK',
      waitingSince: 'wait-1',
      autoResumeSafe: false,
      presentedArtifacts: [],
    },
    ...overrides,
  };
  const engine = new LifecycleController({
    artifactStore,
    statePersistence,
    journalWriter,
    runner: createMockRunnerSystem({ artifactStore }),
    governanceEngine,
    contractRegistry: new DefaultIterationContractRegistry(),
    manifestProducer: createMockManifestProducer(),
  });
  engine.restore(config, state);
  const input: HumanInput = {
    type: 'text',
    content: 'accepted',
    waitIdentity: { stateId: 'WAIT', requestingState: 'WORK', waitingSince: 'wait-1' },
  };
  return {
    engine,
    config,
    state,
    input,
    artifactStore,
    statePersistence,
    journalWriter,
    governanceEngine,
  };
}

describe('human answer acceptance under ownership', () => {
  it('does not replay an older accepted input into a newer wait for the same state', async () => {
    const f = fixture();
    const wait = f.state.waitingContext;
    assert(wait);
    f.engine.restore(f.config, {
      ...f.state,
      waitingContext: { ...wait, waitingSince: 'wait-2' },
      entryActionContinuation: {
        stateId: 'WAIT',
        completedResults: [],
        nextActionIndex: 0,
        resumeInput: f.input,
        resumeWaitingContext: wait,
      },
    });
    const result = await f.engine.resume({
      ...f.input,
      content: 'new answer',
      waitIdentity: { stateId: 'WAIT', requestingState: 'WORK', waitingSince: 'wait-2' },
    });
    expect(result.answerAccepted).toBe(true);
    expect(vi.mocked(f.statePersistence.save).mock.calls[0]?.[0].lastHumanAnswer).toMatchObject({
      content: 'new answer',
      waitingSince: 'wait-2',
    });
  });
  it('reports an answer as unaccepted when governance escalates before the text transition', async () => {
    const f = fixture();
    f.config.workflowDefinition.states.WAIT.transitions =
      f.config.workflowDefinition.states.WAIT.transitions.map((transition) => ({
        ...transition,
        governanceRequired: true,
      }));
    vi.mocked(f.governanceEngine.evaluateTransition).mockReturnValue({
      escalate: true,
      reason: 'human approval required',
    });
    const result = await f.engine.resume(f.input);
    expect(result.answerAccepted).toBe(false);
    expect(
      vi.mocked(f.statePersistence.save).mock.calls.every(([state]) => !state.lastHumanAnswer),
    ).toBe(true);
    expect(
      vi
        .mocked(f.journalWriter.append)
        .mock.calls.some(([event]) => event.type === 'human_input_received'),
    ).toBe(false);
  });
  it('journals a targeted answer only after its accepted checkpoint exists', async () => {
    const f = fixture();
    let accepted = false;
    vi.mocked(f.journalWriter.append).mockImplementation((event) => {
      if (
        event.type === 'workflow_checkpoint' &&
        event.data.state.lastHumanAnswer?.content === 'accepted'
      ) {
        accepted = true;
      }
      if (event.type === 'human_input_received') {
        expect(accepted).toBe(true);
      }
    });
    expect((await f.engine.resume(f.input)).finalState).toBe('DONE');
  });
  it.each(['abort', 'pause'])(
    'runs no exit actions when %s happens during answer checkpoint I/O',
    async (action) => {
      const f = fixture();
      let entered!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(f.statePersistence.save).mockImplementationOnce(() => {
        entered();
        return held;
      });
      const pending = f.engine.resume(f.input);
      await reached;
      const interruption =
        action === 'abort'
          ? f.engine.abort('stop')
          : f.engine.pause({
              reason: 'paused',
              requiredInput: 'approval',
              requestingState: 'WORK',
              waitingSince: 'pause',
              autoResumeSafe: false,
              presentedArtifacts: [],
            });
      release();
      await Promise.all([pending, interruption]);
      expect(vi.mocked(f.artifactStore.store)).not.toHaveBeenCalled();
    },
  );
  it('rejects blank targeted answers before acquiring ownership', async () => {
    const f = fixture();
    await expect(f.engine.resume({ ...f.input, content: '  ' })).rejects.toThrow(
      'current text wait',
    );
    expect(vi.mocked(f.statePersistence.acquireLock)).not.toHaveBeenCalled();
  });
  it('checkpoints content and wait identity before exit effects', async () => {
    const f = fixture();
    vi.mocked(f.artifactStore.store).mockImplementationOnce((artifact) => {
      const saves = vi.mocked(f.statePersistence.save).mock.calls;
      expect(saves[0]?.[0]).toMatchObject({
        lastHumanAnswer: { ...f.input.waitIdentity, content: 'accepted' },
        entryActionContinuation: { resumeInput: f.input },
      });
      return Promise.resolve({
        type: artifact.type,
        name: artifact.name,
        version: 1,
        checksum: 'hash',
      });
    });
    expect((await f.engine.resume(f.input)).finalState).toBe('DONE');
    expect(vi.mocked(f.statePersistence.save).mock.calls.at(-1)?.[0].lastHumanAnswer?.content).toBe(
      'accepted',
    );
  });
  it.each([
    { stateId: 'OTHER', requestingState: 'WORK', waitingSince: 'wait-1' },
    { stateId: 'WAIT', requestingState: 'OTHER', waitingSince: 'wait-1' },
    { stateId: 'WAIT', requestingState: 'WORK', waitingSince: 'old-wait' },
  ])(
    'rejects stale wait identity before ownership or journal effects (%s)',
    async (waitIdentity) => {
      const f = fixture();
      await expect(f.engine.resume({ ...f.input, waitIdentity })).rejects.toThrow(
        'current text wait',
      );
      expect(vi.mocked(f.statePersistence.acquireLock)).not.toHaveBeenCalled();
      expect(vi.mocked(f.journalWriter.append)).not.toHaveBeenCalled();
    },
  );
  it.each(['approval', 'rejection'] as const)(
    'does not let %s carry a text answer identity',
    async (type) => {
      const f = fixture();
      await expect(f.engine.resume({ ...f.input, type })).rejects.toThrow('current text wait');
    },
  );
  it('preserves accepted data when the lock is held by another owner', async () => {
    const f = fixture();
    vi.mocked(f.statePersistence.acquireLock).mockImplementationOnce(() => {
      throw new Error('owned elsewhere');
    });
    await expect(f.engine.resume(f.input)).rejects.toThrow('owned elsewhere');
    expect(vi.mocked(f.statePersistence.save)).not.toHaveBeenCalled();
    expect(vi.mocked(f.artifactStore.store)).not.toHaveBeenCalled();
  });
  it('rejects a text response at an approval wait', async () => {
    const f = fixture();
    const waitingContext = f.state.waitingContext;
    assert(waitingContext);
    f.engine.restore(f.config, {
      ...f.state,
      waitingContext: { ...waitingContext, requiredInput: 'approval' },
    });
    await expect(f.engine.resume(f.input)).rejects.toThrow('current text wait');
  });
  it('does not replace an accepted receipt when no transition matches the answer', async () => {
    const f = fixture({
      lastHumanAnswer: {
        stateId: 'WAIT',
        requestingState: 'WORK',
        waitingSince: 'old-wait',
        content: 'previous',
      },
    });
    f.config.workflowDefinition.states.WAIT.transitions = [];
    await expect(f.engine.resume(f.input)).rejects.toThrow('No matching transition');
    expect(vi.mocked(f.statePersistence.save).mock.calls.at(-1)?.[0].lastHumanAnswer?.content).toBe(
      'previous',
    );
  });
  it('records an accepted answer when resuming an explicitly paused text wait', async () => {
    const f = fixture({ executionPaused: true });
    expect((await f.engine.resume(f.input)).finalState).toBe('DONE');
    expect(vi.mocked(f.statePersistence.save).mock.calls[0]?.[0].lastHumanAnswer).toEqual({
      ...f.input.waitIdentity,
      content: 'accepted',
    });
  });
  it('replays the checkpointed answer instead of accepting a replacement after interruption', async () => {
    const f = fixture();
    f.engine.restore(f.config, {
      ...f.state,
      waitingContext: undefined,
      entryActionContinuation: {
        stateId: 'WAIT',
        completedResults: [],
        nextActionIndex: 0,
        resumeInput: f.input,
        resumeWaitingContext: f.state.waitingContext,
      },
    });
    await f.engine.resume({ ...f.input, content: 'replacement' });
    expect(vi.mocked(f.statePersistence.save).mock.calls[0]?.[0].lastHumanAnswer?.content).toBe(
      'accepted',
    );
  });
});
