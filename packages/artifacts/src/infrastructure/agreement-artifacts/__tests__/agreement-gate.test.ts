import type { ArtifactStore } from '@ai-dev-orchestrator/ports';
import { describe, expect, it, vi } from 'vitest';

import { DefaultAgreementGate } from '../agreement-gate';

function makeMockStore(overrides: Partial<ArtifactStore> = {}): ArtifactStore {
  const base = {
    store: vi.fn(),
    get: vi.fn(),
    getLatest: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    history: vi.fn().mockResolvedValue([]),
    verify: vi.fn(),
    inventory: vi.fn(),
    ...overrides,
  };
  return base;
}

describe('DefaultAgreementGate', () => {
  it('sync check returns exists=false placeholder', () => {
    const store = makeMockStore();
    const gate = new DefaultAgreementGate(store);
    const result = gate.check('planning_agreement', 'run-001');

    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('async check returns exists=false when no agreement artifact found', async () => {
    const store = makeMockStore();
    const gate = new DefaultAgreementGate(store);
    const result = await gate.checkAsync('planning_agreement', 'planning_agreement');

    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('No planning_agreement');
  });

  it('async check returns exists=true, valid=true for valid agreement', async () => {
    const agreement = {
      runId: 'run-001',
      stageId: 'PLAN_REVIEW',
      timestamp: new Date().toISOString(),
      participants: [
        { role: 'planner', action: 'produced' },
        { role: 'plan_reviewer', action: 'approved' },
      ],
      reviewedArtifacts: [{ type: 'plan', name: 'plan', version: 1, checksum: 'abc' }],
      findings: [],
      unresolvedFindings: [],
      approvalStatus: 'approved',
      approvalType: 'automated',
    };

    const store = makeMockStore({
      getLatest: vi.fn().mockResolvedValue({
        content: JSON.stringify(agreement),
        ref: { type: 'planning_agreement', name: 'planning_agreement', version: 1, checksum: 'x' },
      }),
    });

    const gate = new DefaultAgreementGate(store);
    const result = await gate.checkAsync('planning_agreement', 'planning_agreement');

    expect(result.exists).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.approvalStatus).toBe('approved');
  });

  it('async check returns valid=false for invalid JSON content', async () => {
    const store = makeMockStore({
      getLatest: vi.fn().mockResolvedValue({
        content: 'not json',
        ref: { type: 'planning_agreement', name: 'planning_agreement', version: 1, checksum: 'x' },
      }),
    });

    const gate = new DefaultAgreementGate(store);
    const result = await gate.checkAsync('planning_agreement', 'planning_agreement');

    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not valid JSON');
  });

  it('async check returns valid=false for agreement failing validation', async () => {
    const agreement = {
      runId: 'run-001',
      stageId: 'PLAN_REVIEW',
      participants: [],
      reviewedArtifacts: [],
      findings: [],
      unresolvedFindings: [],
      approvalStatus: 'approved',
    };

    const store = makeMockStore({
      getLatest: vi.fn().mockResolvedValue({
        content: JSON.stringify(agreement),
        ref: { type: 'planning_agreement', name: 'planning_agreement', version: 1, checksum: 'x' },
      }),
    });

    const gate = new DefaultAgreementGate(store);
    const result = await gate.checkAsync('planning_agreement', 'planning_agreement');

    expect(result.exists).toBe(true);
    expect(result.valid).toBe(false);
  });
});
