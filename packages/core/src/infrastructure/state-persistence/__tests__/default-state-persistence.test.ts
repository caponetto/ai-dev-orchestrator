import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRunId } from '@ai-dev-orchestrator/ports';
import type { JournalEvent, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeStateChecksum } from '../checksum-verifier';
import { DefaultStatePersistence } from '../default-state-persistence';

const TEST_DIR = join(tmpdir(), `state-persistence-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  const base: PersistedState = {
    runId: createRunId('run-001'),
    schemaVersion: 2,
    currentState: 'PLANNING',
    previousState: 'INTAKE',
    stateEnteredAt: '2026-01-01T00:00:00Z',
    transitionCount: 2,
    stateHistory: ['INTAKE', 'PLANNING'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    workflowName: 'default',
    workflowVersion: '1.0.0',
    persistedAt: '2026-01-01T00:00:00Z',
    persistenceVersion: 1,
    checksum: '',
    ...overrides,
  };
  return { ...base, checksum: computeStateChecksum(base) };
}

describe('DefaultStatePersistence', () => {
  it('saves and loads state', async () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState();
    await persistence.save(state);
    const loaded = persistence.load(createRunId('run-001'));
    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe('run-001');
    expect(loaded?.currentState).toBe('PLANNING');
  });

  it('returns null for non-existent run', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    expect(persistence.load(createRunId('missing'))).toBeNull();
  });

  it('exists returns true after save', async () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    expect(persistence.exists(createRunId('run-001'))).toBe(false);
    await persistence.save(makeState());
    expect(persistence.exists(createRunId('run-001'))).toBe(true);
  });

  it('validates a well-formed state', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState();
    const result = persistence.validate(state);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports validation errors for corrupt checksum', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState({ checksum: 'sha256:0000' });
    const result = persistence.validate({ ...state, checksum: 'sha256:invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Checksum'))).toBe(true);
  });

  it('reports missing runId in validation', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState({ runId: '' as RunId });
    const result = persistence.validate(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing runId'))).toBe(true);
  });

  it('reports missing currentState in validation', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState({ currentState: '' });
    const result = persistence.validate(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing currentState'))).toBe(true);
  });

  it('reports error for schema version below minimum', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState({ schemaVersion: 0 });
    const result = persistence.validate(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Schema version'))).toBe(true);
  });

  it('reports negative transitionCount as error', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const state = makeState({ transitionCount: -1 });
    const result = persistence.validate(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('transitionCount'))).toBe(true);
  });

  it('probeLock delegates to lock manager', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const result = persistence.probeLock(createRunId('run-nonexistent'));
    expect(result.exists).toBe(false);
    expect(result.pidRunning).toBe(false);
    expect(result.unreadable).toBe(false);
  });

  it('acquires and releases lock', () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    const handle = persistence.acquireLock(createRunId('run-001'));
    expect(handle.runId).toBe('run-001');
    persistence.releaseLock(handle);
  });

  it('overwrites state on subsequent saves', async () => {
    const persistence = new DefaultStatePersistence(TEST_DIR);
    await persistence.save(makeState({ transitionCount: 1 }));
    await persistence.save(makeState({ transitionCount: 5 }));
    const loaded = persistence.load(createRunId('run-001'));
    expect(loaded?.transitionCount).toBe(5);
  });

  describe('reconstructFromJournal', () => {
    it('returns null when no events match the run', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const result = persistence.reconstructFromJournal(createRunId('run-001'), []);
      expect(result).toBeNull();
    });

    it('reconstructs initial state from run_started event', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'my-workflow',
            workflowVersion: '2.0.0',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('INTAKE');
      expect(result?.workflowName).toBe('my-workflow');
      expect(result?.workflowVersion).toBe('2.0.0');
      expect(result?.transitionCount).toBe(0);
      expect(result?.checksum).toMatch(/^sha256:/);
    });

    it('reconstructs state after multiple transitions', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'INTAKE',
            to: 'PLANNING',
            trigger: 'completion',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
        {
          timestamp: '2026-01-01T00:02:00Z',
          runId: 'run-001',
          sequence: 3,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'PLANNING',
            to: 'IMPLEMENTATION',
            trigger: 'completion',
            durationMs: 2000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('IMPLEMENTATION');
      expect(result?.previousState).toBe('PLANNING');
      expect(result?.transitionCount).toBe(2);
      expect(result?.stateHistory).toContain('INTAKE');
      expect(result?.stateHistory).toContain('PLANNING');
      expect(result?.stateHistory).toContain('IMPLEMENTATION');
    });

    it('reconstructs artifact references from artifact_stored events', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'artifact_stored',
          data: {
            kind: 'artifact',
            artifactRef: {
              type: 'canonical_specification',
              name: 'specification',
              version: 1,
              checksum: 'sha256:abc',
            },
            producedBy: 'specifier',
            sizeBytes: 1024,
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.activeArtifacts).toHaveLength(1);
      expect(result?.activeArtifacts[0].type).toBe('canonical_specification');
      expect(result?.lastProducedArtifact?.type).toBe('canonical_specification');
    });

    it('filters events to the requested runId only', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-002',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'other',
            workflowVersion: '3.0.0',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.workflowName).toBe('default');
    });

    it('produces a valid checksum on reconstructed state', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      if (result === null) {
        return;
      }
      const validation = persistence.validate(result);
      expect(validation.valid).toBe(true);
    });

    it('restores waitingContext from human_input_requested event', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'INTAKE',
            to: 'WAITING_FOR_HUMAN',
            trigger: 'human_input',
            durationMs: 1000,
            guardsEvaluated: 0,
            guardsPassed: 0,
            governanceRequired: false,
          },
        },
        {
          timestamp: '2026-01-01T00:01:01Z',
          runId: 'run-001',
          sequence: 3,
          type: 'human_input_requested',
          data: {
            kind: 'human',
            action: 'input_requested',
            stateId: 'WAITING_FOR_HUMAN',
            reason: 'clarification_needed',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('WAITING_FOR_HUMAN');
      expect(result?.waitingContext).toBeDefined();
      expect(result?.waitingContext?.reason).toBe('clarification_needed');
      expect(result?.waitingContext?.requiredInput).toBe('text');
      expect(result?.waitingContext?.autoResumeSafe).toBe(false);
      expect(result?.waitingContext?.waitingSince).toBe('2026-01-01T00:01:01Z');
    });

    it('clears waitingContext after human_approval event', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'human_input_requested',
          data: {
            kind: 'human',
            action: 'input_requested',
            stateId: 'WAITING_FOR_HUMAN',
            reason: 'waiting_for_human',
          },
        },
        {
          timestamp: '2026-01-01T00:02:00Z',
          runId: 'run-001',
          sequence: 3,
          type: 'human_approval',
          data: {
            kind: 'human',
            action: 'approval',
            stateId: 'WAITING_FOR_HUMAN',
            inputType: 'approval',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.waitingContext).toBeUndefined();
    });

    it('tracks judgeArbitrationCounts only for JUDGE_ARBITRATION entries keyed by contractId', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'CODE_REVIEW',
            to: 'JUDGE_REVIEW',
            trigger: 'completion',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
            contractId: 'implementation_review_loop',
          },
        },
        {
          timestamp: '2026-01-01T00:02:00Z',
          runId: 'run-001',
          sequence: 3,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'CODE_REVIEW',
            to: 'JUDGE_REVIEW',
            trigger: 'completion',
            durationMs: 500,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
            contractId: 'implementation_review_loop',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.judgeArbitrationCounts).toEqual({ implementation_review_loop: 2 });
    });

    it('does not count governed transitions that are not JUDGE_ARBITRATION entries', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'REVIEW',
            to: 'IMPLEMENTATION',
            trigger: 'judge_approved',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: true,
            governanceOutcome: 'allowed',
            contractId: 'implementation_review_loop',
          },
        },
        {
          timestamp: '2026-01-01T00:02:00Z',
          runId: 'run-001',
          sequence: 3,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'REVIEW',
            to: 'WAITING_FOR_HUMAN',
            trigger: 'escalation',
            durationMs: 0,
            guardsEvaluated: 0,
            guardsPassed: 0,
            governanceRequired: true,
            governanceOutcome: 'escalated',
            contractId: 'implementation_review_loop',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.judgeArbitrationCounts).toEqual({});
    });

    it('does not count JUDGE_ARBITRATION entry without contractId (legacy journals)', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'CODE_REVIEW',
            to: 'JUDGE_REVIEW',
            trigger: 'completion',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.judgeArbitrationCounts).toEqual({});
    });

    it('reconstructs waitingContext from wait-state human_input_requested event', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'REFINEMENT',
            to: 'WAITING_FOR_HUMAN',
            trigger: 'completion',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
        {
          timestamp: '2026-01-01T00:01:01Z',
          runId: 'run-001',
          sequence: 3,
          type: 'human_input_requested',
          data: {
            kind: 'human',
            action: 'input_requested',
            stateId: 'WAITING_FOR_HUMAN',
            reason: 'waiting_for_human',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('WAITING_FOR_HUMAN');
      expect(result?.waitingContext).toBeDefined();
      expect(result?.waitingContext?.reason).toBe('waiting_for_human');
      expect(result?.waitingContext?.requiredInput).toBe('approval');
      expect(result?.waitingContext?.requestingState).toBe('REFINEMENT');
      expect(result?.waitingContext?.autoResumeSafe).toBe(true);
    });

    it('reconstructs waitingContext from escalation-to-READY_FOR_HUMAN with autoResumeSafe false', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'REVIEW',
            to: 'WAITING_FOR_HUMAN',
            trigger: 'escalation',
            durationMs: 0,
            guardsEvaluated: 0,
            guardsPassed: 0,
            governanceRequired: true,
            governanceOutcome: 'escalated',
          },
        },
        {
          timestamp: '2026-01-01T00:01:01Z',
          runId: 'run-001',
          sequence: 3,
          type: 'human_input_requested',
          data: {
            kind: 'human',
            action: 'input_requested',
            stateId: 'WAITING_FOR_HUMAN',
            reason: 'governance_escalation',
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('WAITING_FOR_HUMAN');
      expect(result?.waitingContext).toBeDefined();
      expect(result?.waitingContext?.reason).toBe('governance_escalation');
      expect(result?.waitingContext?.requiredInput).toBe('approval');
      expect(result?.waitingContext?.requestingState).toBe('REVIEW');
      expect(result?.waitingContext?.autoResumeSafe).toBe(false);
    });

    it('sorts out-of-order events by sequence before reconstruction', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:02:00Z',
          runId: 'run-001',
          sequence: 3,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'PLANNING',
            to: 'IMPLEMENTATION',
            trigger: 'completion',
            durationMs: 50,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: {
            kind: 'run_lifecycle',
            workflowName: 'default',
            workflowVersion: '1.0.0',
          },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'INTAKE',
            to: 'PLANNING',
            trigger: 'completion',
            durationMs: 100,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.currentState).toBe('IMPLEMENTATION');
      expect(result?.previousState).toBe('PLANNING');
      expect(result?.transitionCount).toBe(2);
      expect(result?.stateHistory).toEqual(['INTAKE', 'PLANNING', 'IMPLEMENTATION']);
    });

    it('does not count non-governance transitions in judgeArbitrationCounts', () => {
      const persistence = new DefaultStatePersistence(TEST_DIR);
      const events: JournalEvent[] = [
        {
          timestamp: '2026-01-01T00:00:00Z',
          runId: 'run-001',
          sequence: 1,
          type: 'run_started',
          data: { kind: 'run_lifecycle', workflowName: 'default', workflowVersion: '1.0.0' },
        },
        {
          timestamp: '2026-01-01T00:01:00Z',
          runId: 'run-001',
          sequence: 2,
          type: 'state_transition',
          data: {
            kind: 'state_transition',
            from: 'INTAKE',
            to: 'PLANNING',
            trigger: 'completion',
            durationMs: 1000,
            guardsEvaluated: 1,
            guardsPassed: 1,
            governanceRequired: false,
          },
        },
      ];
      const result = persistence.reconstructFromJournal(createRunId('run-001'), events);

      expect(result).not.toBeNull();
      expect(result?.judgeArbitrationCounts).toEqual({});
    });
  });
});
