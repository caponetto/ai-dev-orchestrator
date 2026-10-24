import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-dev-orchestrator/artifacts';
import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import {
  DefaultGovernanceEngine,
  DefaultIterationContractRegistry,
} from '@ai-dev-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import type { RunnerSystem } from '@ai-dev-orchestrator/ports';
import { createRunId } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import {
  DefaultManifestProducer,
  FilesystemManifestWriter,
} from '@ai-dev-orchestrator/run-manifest';
import {
  AgentSessionRegistry,
  DefaultAgentSessionStore,
  RemoteAgentSessionSupervisor,
  WebSocketProtocolTransport,
} from '@ai-dev-orchestrator/runner';
import type { WebSocketLike } from '@ai-dev-orchestrator/runner';
import type { AgentSessionRef, WorkflowRunConfig } from '@ai-dev-orchestrator/schemas';
import { TEST_ROLES } from '@ai-dev-orchestrator/test-utils';

import { LifecycleController } from '../../src/infrastructure/workflow-engine/lifecycle-controller';

export const COMPLETION_RUN_ID = createRunId('remote-completion');
const COMPLETION_PLAN = JSON.stringify({
  version: 1,
  specificationRef: { type: 'canonical_specification', name: 'input', version: 1 },
  createdAt: '2026-10-23T00:00:00Z',
  summary: 'Durable remote plan',
  tasks: [
    { taskId: 'task-1', description: 'Recover remote completion', files: [], dependencies: [] },
  ],
});

export async function createRemoteCompletionHarness(root: string) {
  const runDir = join(root, COMPLETION_RUN_ID);
  const journalPath = join(runDir, 'journal.md');
  const sessions = new DefaultAgentSessionStore(root);
  const registry = new AgentSessionRegistry(sessions);
  await registry.rebuild();
  const supervisor = new RemoteAgentSessionSupervisor(registry);
  const socket = new EventEmitter() as EventEmitter & WebSocketLike;
  Object.defineProperty(socket, 'readyState', { value: 1 });
  const sent: string[] = [];
  socket.send = (data) => {
    sent.push(data);
  };
  socket.close = () => undefined;
  socket.addEventListener = ((name: string, callback: (...args: unknown[]) => void) => {
    socket.on(name, callback);
  }) as WebSocketLike['addEventListener'];
  socket.removeEventListener = (name, callback) => {
    socket.off(name, callback);
  };
  let sequence = 0;
  const emit = (type: string, payload: Record<string, unknown>) => {
    socket.emit('message', {
      data: JSON.stringify({
        protocol: 'ado/agent/v1',
        messageId: `fixture-${String(++sequence)}`,
        timestamp: new Date().toISOString(),
        type,
        payload,
      }),
    });
  };
  const ref: AgentSessionRef = {
    sessionId: 'remote-session',
    runId: COMPLETION_RUN_ID,
    stateId: 'WORK',
    role: 'planner',
    transport: 'remote',
  };
  if (!registry.get(ref.sessionId)) {
    await supervisor.createSession(
      ref,
      undefined,
      {
        type: 'remote',
        remoteSessionId: 'remote-session',
        reconnectUrl: 'https://fixture.invalid/reconnect',
      },
      new WebSocketProtocolTransport(socket),
    );
  }
  const dispatchFile = join(root, 'dispatches.log');
  const runner: RunnerSystem = {
    dispatch: async () => {
      appendFileSync(dispatchFile, 'dispatch\n');
      emit('permission_request', { action: 'read', resource: '/source', riskLevel: 'low' });
      const pending = await supervisor.waitForAdvance(ref.sessionId);
      assert.equal(pending.kind, 'awaiting_human');
      return {
        workerId: 'worker',
        role: 'planner',
        status: 'success',
        outputArtifacts: [],
        metrics: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          retryCount: 0,
          modelUsed: 'fixture',
        },
        sessionOutcome: 'awaiting_human',
        sessionRef: ref,
        pendingRequest: pending.pendingRequest,
      };
    },
    dispatchParallel: () => Promise.resolve([]),
    getWorkerStatus: () => null,
    cancelWorker: () => Promise.resolve(),
    cancelAllWorkers: () => Promise.resolve(),
    setWorkerCounter: () => undefined,
  };
  const artifacts = new FilesystemArtifactStore(
    runDir,
    COMPLETION_RUN_ID,
    new DefaultOwnershipRegistry(),
    new DefaultArtifactTypeValidator(),
  );
  const persistence = new DefaultStatePersistence(root);
  const events = new DefaultJournalReader(journalPath).readAll();
  const journal = new DefaultJournalWriter(
    journalPath,
    COMPLETION_RUN_ID,
    Math.max(0, ...events.map((event) => event.sequence)),
  );
  const manifestWriter = new FilesystemManifestWriter(root);
  const contracts = new DefaultIterationContractRegistry();
  const controller = new LifecycleController({
    runner,
    artifactStore: artifacts,
    statePersistence: persistence,
    journalWriter: journal,
    manifestWriter,
    manifestProducer: new DefaultManifestProducer(),
    sessionSupervisor: supervisor,
    contractRegistry: contracts,
    governanceEngine: new DefaultGovernanceEngine(contracts),
    roleRegistry: new DefaultRoleRegistry(TEST_ROLES, { assignments: {} }),
  });
  const config: WorkflowRunConfig = {
    runId: COMPLETION_RUN_ID,
    runDir,
    repoRoot: root,
    governancePolicy: {},
    roleAssignments: {},
    sources: [],
    workflowDefinition: {
      name: 'remote-completion',
      version: '1',
      initialState: 'WORK',
      terminalStates: ['DONE', 'FAILED'],
      states: {
        WORK: {
          type: 'action',
          description: '',
          entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
          transitions: [
            {
              target: 'DONE',
              trigger: 'completion',
              guards: [],
              priority: 0,
              governanceRequired: false,
            },
            {
              target: 'FAILED',
              trigger: 'failure',
              guards: [],
              priority: 0,
              governanceRequired: false,
            },
          ],
        },
        WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
        DONE: { type: 'terminal', description: '', transitions: [] },
        FAILED: { type: 'terminal', description: '', transitions: [] },
      },
    },
  };
  return {
    controller,
    config,
    artifacts,
    persistence,
    journal,
    journalPath,
    supervisor,
    manifestWriter,
    sent,
    ref,
    complete: async (content = COMPLETION_PLAN) => {
      emit('artifact', { artifactType: 'plan', content, isFinal: true });
      emit('done', { summary: 'finished', tokenUsage: { inputTokens: 30, outputTokens: 20 } });
      return supervisor.waitForAdvance(ref.sessionId);
    },
    dispatches: () =>
      existsSync(dispatchFile) ? readFileSync(dispatchFile, 'utf8').trim().split('\n').length : 0,
  };
}
