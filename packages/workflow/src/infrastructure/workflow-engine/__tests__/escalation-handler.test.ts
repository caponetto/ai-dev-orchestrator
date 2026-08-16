import { createRunId } from '@ai-orchestrator/ports';
import type { EscalationContext } from '@ai-orchestrator/schemas';
import { beforeEach, describe, expect, it } from 'vitest';

import { EscalationHandler } from '../escalation-handler';

const appendedEntries: unknown[] = [];
const mockJournalWriter = {
  append: (entry: unknown) => {
    appendedEntries.push(entry);
  },
};

describe('EscalationHandler', () => {
  const handler = new EscalationHandler(mockJournalWriter as never);

  beforeEach(() => {
    appendedEntries.length = 0;
  });

  describe('enterEscalation()', () => {
    it('records escalation event in journal', () => {
      const context: EscalationContext = {
        runId: createRunId('run-1'),
        stageId: 'IMPLEMENTATION',
        reason: 'iteration_limit_exceeded',
        iterationHistory: [],
        unresolvedFindings: [{ id: 'f-1', severity: 'high', status: 'open', description: 'Bug' }],
        artifactRefs: [],
        suggestedActions: ['Review findings'],
      };

      handler.enterEscalation(createRunId('run-1'), 'IMPLEMENTATION', context);
      expect(appendedEntries).toHaveLength(1);
      const entry = appendedEntries[0] as Record<string, unknown>;
      expect(entry['type']).toBe('escalation');
    });
  });

  describe('resolveEscalationTarget()', () => {
    it('returns READY_FOR_HUMAN for iteration_limit_exceeded', () => {
      expect(handler.resolveEscalationTarget('iteration_limit_exceeded')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns READY_FOR_HUMAN for quality_gate_failed', () => {
      expect(handler.resolveEscalationTarget('quality_gate_failed')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns READY_FOR_HUMAN for unresolvable_conflict', () => {
      expect(handler.resolveEscalationTarget('unresolvable_conflict')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns WAITING_FOR_HUMAN for human_requested', () => {
      expect(handler.resolveEscalationTarget('human_requested')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns WAITING_FOR_HUMAN for token_budget_exceeded', () => {
      expect(handler.resolveEscalationTarget('token_budget_exceeded')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns WAITING_FOR_HUMAN for retry_limit_exceeded', () => {
      expect(handler.resolveEscalationTarget('retry_limit_exceeded')).toBe('WAITING_FOR_HUMAN');
    });

    it('returns WAITING_FOR_HUMAN for confidence_too_low', () => {
      expect(handler.resolveEscalationTarget('confidence_too_low')).toBe('WAITING_FOR_HUMAN');
    });
  });

  describe('isEscalationState()', () => {
    it('identifies READY_FOR_HUMAN as escalation state', () => {
      expect(handler.isEscalationState('WAITING_FOR_HUMAN')).toBe(true);
    });

    it('identifies WAITING_FOR_HUMAN as escalation state', () => {
      expect(handler.isEscalationState('WAITING_FOR_HUMAN')).toBe(true);
    });

    it('does not flag regular states', () => {
      expect(handler.isEscalationState('IMPLEMENTATION')).toBe(false);
    });
  });
});
