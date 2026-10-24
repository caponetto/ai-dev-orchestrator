import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-dev-orchestrator/artifacts';
import { DefaultIterationContractRegistry } from '@ai-dev-orchestrator/governance';
import type { AgentSessionSupervisor } from '@ai-dev-orchestrator/ports';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import {
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
  TEST_ROLES,
} from '@ai-dev-orchestrator/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../../src/infrastructure/workflow-engine/lifecycle-controller';

describe('live session output validation', () => {
  it.each([
    ['review', 'plan_reviewer', 'plan_review', 'review_approved', 'review_rejected'],
    ['judge', 'judge', 'judge_decision', 'judge_approved', 'judge_rejected'],
  ] as const)(
    'rejects malformed approved %s output after session reattachment',
    async (stateType, role, artifactType, approved, rejected) => {
      const dir = mkdtempSync(join(tmpdir(), 'session-validation-'));
      try {
        const content = JSON.stringify({ approved: true });
        const validator = new DefaultArtifactTypeValidator();
        expect(validator.validate(artifactType, content).valid).toBe(false);
        const artifactStore = new FilesystemArtifactStore(
          dir,
          'validation',
          new DefaultOwnershipRegistry(),
          validator,
        );
        const runner = createMockRunnerSystem();
        const ref = {
          sessionId: 'session',
          runId: 'validation',
          stateId: 'REVIEW',
          role,
          transport: 'remote' as const,
        };
        vi.mocked(runner).dispatch.mockResolvedValue({
          workerId: 'worker',
          role,
          status: 'success',
          outputArtifacts: [],
          metrics: {
            startedAt: '',
            completedAt: '',
            durationMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            retryCount: 0,
            modelUsed: 'test',
          },
          sessionOutcome: 'awaiting_human',
          sessionRef: ref,
        });
        const sessionSupervisor: AgentSessionSupervisor = {
          createSession: vi.fn(),
          attach: vi.fn().mockResolvedValue({ ref, state: 'awaiting_human', pendingRequests: [] }),
          waitForAdvance: vi
            .fn()
            .mockResolvedValue({ kind: 'completed', artifactContent: content, durationMs: 1 }),
          sendHumanResponse: vi.fn(),
          pause: vi.fn(),
          abort: vi.fn(),
          finalize: vi.fn(),
          getSnapshot: vi.fn(),
          getState: vi.fn(),
          listByRun: vi.fn(),
        };
        const controller = new LifecycleController({
          runner,
          artifactStore,
          sessionSupervisor,
          roleRegistry: new DefaultRoleRegistry(TEST_ROLES),
          governanceEngine: createMockGovernance(),
          contractRegistry: new DefaultIterationContractRegistry(),
          journalWriter: createMockJournalWriter(),
          statePersistence: createMockStatePersistence(),
          manifestProducer: createMockManifestProducer(),
        });
        await controller.start({
          runId: 'validation',
          sources: [],
          governancePolicy: {},
          roleAssignments: {},
          workflowDefinition: {
            name: 'validation',
            version: '1',
            initialState: 'REVIEW',
            terminalStates: ['DONE', 'FAILED'],
            states: {
              REVIEW: {
                type: stateType,
                description: '',
                entryActions: [{ type: 'dispatch_worker', params: { role } }],
                transitions: [
                  {
                    target: 'DONE',
                    trigger: approved,
                    guards: [],
                    priority: 1,
                    governanceRequired: false,
                  },
                  {
                    target: 'FAILED',
                    trigger: rejected,
                    guards: [],
                    priority: 2,
                    governanceRequired: false,
                  },
                ],
              },
              WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
              DONE: { type: 'terminal', description: '', transitions: [] },
              FAILED: { type: 'terminal', description: '', transitions: [] },
            },
          },
        });
        expect((await controller.resume({ type: 'approval', content: 'yes' })).finalState).toBe(
          'FAILED',
        );
        const artifact = await artifactStore.getLatest(artifactType, `${role}-output`);
        expect(artifact?.metadata?.validationFailed).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
