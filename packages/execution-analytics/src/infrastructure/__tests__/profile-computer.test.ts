import type { ExecutionProfile, WorkerOutcomeRecord } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ProfileComputer } from '../profile-computer';

function makeOutcome(overrides: Partial<WorkerOutcomeRecord> = {}): WorkerOutcomeRecord {
  return {
    roleId: 'implementer',
    model: 'claude-sonnet-5',
    inputTokens: 1000,
    outputTokens: 500,
    durationMs: 5000,
    retryCount: 0,
    status: 'success',
    errorType: null,
    confidenceScore: 0.9,
    ...overrides,
  };
}

describe('ProfileComputer', () => {
  const computer = new ProfileComputer();

  describe('update from empty', () => {
    it('should create a profile from a single outcome', () => {
      const outcomes = [makeOutcome()];
      const profile = computer.update(null, outcomes);

      expect(profile.roleId).toBe('implementer');
      expect(profile.model).toBe('claude-sonnet-5');
      expect(profile.sampleSize).toBe(1);
      expect(profile.tokenUsage.outputTokens.p50).toBe(500);
      expect(profile.tokenUsage.outputTokens.ema).toBe(500);
      expect(profile.reliability.successRate).toBe(1);
      expect(profile.reliability.failureRate).toBe(0);
      expect(profile.timing.durationMs.p50).toBe(5000);
      expect(profile.confidence.avgConfidence).toBe(0.9);
    });

    it('should compute percentiles from multiple outcomes', () => {
      const outcomes = [
        makeOutcome({ outputTokens: 100 }),
        makeOutcome({ outputTokens: 200 }),
        makeOutcome({ outputTokens: 300 }),
        makeOutcome({ outputTokens: 400 }),
        makeOutcome({ outputTokens: 500 }),
        makeOutcome({ outputTokens: 600 }),
        makeOutcome({ outputTokens: 700 }),
        makeOutcome({ outputTokens: 800 }),
        makeOutcome({ outputTokens: 900 }),
        makeOutcome({ outputTokens: 1000 }),
      ];
      const profile = computer.update(null, outcomes);

      expect(profile.sampleSize).toBe(10);
      expect(profile.tokenUsage.outputTokens.p50).toBe(550);
      expect(profile.tokenUsage.outputTokens.p75).toBeGreaterThanOrEqual(750);
      expect(profile.tokenUsage.outputTokens.p90).toBeGreaterThanOrEqual(900);
      expect(profile.tokenUsage.outputTokens.max).toBe(1000);
    });

    it('should compute reliability from mixed outcomes', () => {
      const outcomes = [
        makeOutcome({ status: 'success' }),
        makeOutcome({ status: 'success' }),
        makeOutcome({ status: 'failure', errorType: 'agent_error' }),
        makeOutcome({ status: 'failure', errorType: 'timeout' }),
        makeOutcome({ status: 'failure', errorType: 'schema_violation' }),
      ];
      const profile = computer.update(null, outcomes);

      expect(profile.reliability.successRate).toBeCloseTo(0.4, 1);
      expect(profile.reliability.failureRate).toBeCloseTo(0.6, 1);
      expect(profile.reliability.retryableFailureRate).toBeCloseTo(2 / 3, 1);
      expect(profile.reliability.commonErrorTypes).toHaveLength(3);
    });
  });

  describe('update from existing', () => {
    it('should merge new outcomes with existing profile using EMA', () => {
      const first = [makeOutcome({ outputTokens: 100 })];
      const profile1 = computer.update(null, first);

      const second = [makeOutcome({ outputTokens: 200 })];
      const profile2 = computer.update(profile1, second);

      expect(profile2.sampleSize).toBe(2);
      expect(profile2.tokenUsage.outputTokens.ema).toBeGreaterThan(100);
      expect(profile2.tokenUsage.outputTokens.ema).toBeLessThanOrEqual(200);
    });

    it('should accumulate sample size across updates', () => {
      let profile: ExecutionProfile | null = null;
      for (let i = 0; i < 5; i++) {
        profile = computer.update(profile, [makeOutcome()]);
      }
      expect(profile).not.toBeNull();
      expect(profile?.sampleSize).toBe(5);
    });
  });

  describe('EMA decay', () => {
    it('should weight recent values more heavily', () => {
      let profile: ExecutionProfile | null = null;
      for (let i = 0; i < 10; i++) {
        profile = computer.update(profile, [makeOutcome({ outputTokens: 100 })]);
      }
      expect(profile).not.toBeNull();
      const stableProfile = profile as ExecutionProfile;
      const afterSpike = computer.update(stableProfile, [makeOutcome({ outputTokens: 1000 })]);

      expect(afterSpike.tokenUsage.outputTokens.ema).toBeGreaterThan(
        stableProfile.tokenUsage.outputTokens.ema,
      );
      expect(afterSpike.tokenUsage.outputTokens.ema).toBeLessThan(1000);
    });
  });

  describe('confidence tracking', () => {
    it('should handle null confidence scores', () => {
      const outcomes = [
        makeOutcome({ confidenceScore: null }),
        makeOutcome({ confidenceScore: null }),
      ];
      const profile = computer.update(null, outcomes);
      expect(profile.confidence.avgConfidence).toBe(0);
    });

    it('should compute weighted average confidence across updates', () => {
      const profile1 = computer.update(null, [makeOutcome({ confidenceScore: 0.8 })]);
      const profile2 = computer.update(profile1, [makeOutcome({ confidenceScore: 0.6 })]);
      expect(profile2.confidence.avgConfidence).toBeCloseTo(0.7, 1);
    });
  });
});
