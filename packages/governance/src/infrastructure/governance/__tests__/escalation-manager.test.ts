import { createRunId } from '@ai-dev-orchestrator/ports';
import type { FindingSummary } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { EscalationManager } from '../escalation-manager';

const manager = new EscalationManager();

describe('EscalationManager', () => {
  it('builds context with unresolved findings', () => {
    const findings: FindingSummary[] = [
      { id: 'f1', severity: 'high', status: 'open', description: 'Bug' },
      { id: 'f2', severity: 'medium', status: 'addressed', description: 'Fixed' },
      { id: 'f3', severity: 'low', status: 'escalated', description: 'Escalated' },
    ];

    const context = manager.buildContext(
      createRunId('run-001'),
      'PLAN_REVIEW',
      'iteration_limit_exceeded',
      findings,
      [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
    );

    expect(context.runId).toBe('run-001');
    expect(context.stageId).toBe('PLAN_REVIEW');
    expect(context.reason).toBe('iteration_limit_exceeded');
    expect(context.unresolvedFindings).toHaveLength(2);
    expect(context.artifactRefs).toHaveLength(1);
  });

  it('suggests actions for iteration_limit_exceeded', () => {
    const context = manager.buildContext(
      createRunId('run-001'),
      'PLAN_REVIEW',
      'iteration_limit_exceeded',
      [],
      [],
    );
    expect(context.suggestedActions.length).toBeGreaterThan(0);
    expect(context.suggestedActions.some((a) => a.includes('iteration'))).toBe(true);
  });

  it('suggests actions for quality_gate_failed', () => {
    const findings: FindingSummary[] = [
      { id: 'f1', severity: 'high', status: 'open', description: 'Critical bug' },
    ];
    const context = manager.buildContext(
      createRunId('run-001'),
      'VERIFICATION',
      'quality_gate_failed',
      findings,
      [],
    );
    expect(context.suggestedActions.some((a) => a.includes('unresolved'))).toBe(true);
  });

  it('suggests actions for human_requested', () => {
    const context = manager.buildContext(
      createRunId('run-001'),
      'IMPLEMENTATION',
      'human_requested',
      [],
      [],
    );
    expect(context.suggestedActions.some((a) => a.includes('Human'))).toBe(true);
  });

  it('returns empty iteration history in reference scope', () => {
    const context = manager.buildContext(
      createRunId('run-001'),
      'PLAN_REVIEW',
      'iteration_limit_exceeded',
      [],
      [],
    );
    expect(context.iterationHistory).toEqual([]);
  });
});
