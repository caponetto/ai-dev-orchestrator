import type { ArtifactStore } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { DefaultAgreementGate } from '../agreement-gate';

const mockArtifactStore = {
  store: () =>
    Promise.resolve({
      type: 'planning_agreement' as const,
      name: 'test',
      version: 1,
      checksum: 'abc',
    }),
  getLatest: () => Promise.resolve(null),
  history: () => Promise.resolve([]),
  get: () => Promise.reject(new Error('not found')),
  verify: () => Promise.resolve(true),
} as unknown as ArtifactStore;

describe('DefaultAgreementGate — Stage Gating', () => {
  const gate = new DefaultAgreementGate(mockArtifactStore);

  describe('getRequiredAgreement()', () => {
    it('returns planning_agreement for IMPLEMENTATION stage', () => {
      expect(gate.getRequiredAgreement('IMPLEMENTATION')).toBe('planning_agreement');
    });

    it('returns implementation_agreement for VERIFICATION stage', () => {
      expect(gate.getRequiredAgreement('VERIFICATION')).toBe('implementation_agreement');
    });

    it('returns null for WAITING_FOR_HUMAN stage (no agreement gate)', () => {
      expect(gate.getRequiredAgreement('WAITING_FOR_HUMAN')).toBeNull();
    });

    it('returns release_agreement for WRAP_UP stage', () => {
      expect(gate.getRequiredAgreement('WRAP_UP')).toBe('release_agreement');
    });

    it('returns null for ungated stages', () => {
      expect(gate.getRequiredAgreement('INTAKE')).toBeNull();
      expect(gate.getRequiredAgreement('PLANNING')).toBeNull();
    });
  });

  describe('checkStageGating()', () => {
    it('reports ungated stages as not gated', () => {
      const result = gate.checkStageGating('INTAKE');
      expect(result.gated).toBe(false);
      expect(result.satisfied).toBe(true);
    });

    it('reports gated stages with required agreement type', () => {
      const result = gate.checkStageGating('IMPLEMENTATION');
      expect(result.gated).toBe(true);
      expect(result.requiredAgreement).toBe('planning_agreement');
    });

    it('reports gated stage as not satisfied when no agreement exists', () => {
      const result = gate.checkStageGating('VERIFICATION');
      expect(result.gated).toBe(true);
      expect(result.satisfied).toBe(false);
    });
  });
});
