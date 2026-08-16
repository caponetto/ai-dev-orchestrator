import { describe, expect, it } from 'vitest';

import { renderJudgeDecision } from '../judge-renderer';
import type { JudgeDecisionView } from '../shared';

describe('renderJudgeDecision', () => {
  describe('heading — verdict resolution', () => {
    it('includes verdict in heading when present', () => {
      const view: JudgeDecisionView = { verdict: 'approve' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('# Judge Decision: approve');
    });

    it('falls back to decision when verdict is absent', () => {
      const view: JudgeDecisionView = { decision: 'reject' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('# Judge Decision: reject');
    });

    it('prefers verdict over decision when both present', () => {
      const view: JudgeDecisionView = { verdict: 'approve', decision: 'reject' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('# Judge Decision: approve');
      expect(result).not.toContain('reject');
    });

    it('omits suffix when both verdict and decision are absent', () => {
      const view: JudgeDecisionView = {};
      const result = renderJudgeDecision(view);
      expect(result).toBe('# Judge Decision');
    });
  });

  describe('metadata', () => {
    it('renders metadata when id and version are present', () => {
      const view = { verdict: 'approve', id: 'jd-001', version: 2 } as unknown as JudgeDecisionView;
      const result = renderJudgeDecision(view);
      expect(result).toContain('**Id:** jd-001');
      expect(result).toContain('**Version:** 2');
    });

    it('omits metadata when no metadata keys are present', () => {
      const view: JudgeDecisionView = { verdict: 'approve' };
      const result = renderJudgeDecision(view);
      const sections = result.split('\n\n');
      expect(sections).toHaveLength(1);
    });
  });

  describe('reasoning', () => {
    it('renders reasoning when present', () => {
      const view: JudgeDecisionView = { reasoning: 'Code quality is high' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('## Reasoning');
      expect(result).toContain('Code quality is high');
    });

    it('falls back to rationale when reasoning is absent', () => {
      const view: JudgeDecisionView = { rationale: 'Tests pass' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('## Reasoning');
      expect(result).toContain('Tests pass');
    });

    it('prefers reasoning over rationale when both present', () => {
      const view: JudgeDecisionView = { reasoning: 'Primary', rationale: 'Secondary' };
      const result = renderJudgeDecision(view);
      expect(result).toContain('Primary');
      expect(result).not.toContain('Secondary');
    });

    it('omits reasoning section when neither is present', () => {
      const view: JudgeDecisionView = { verdict: 'approve' };
      const result = renderJudgeDecision(view);
      expect(result).not.toContain('## Reasoning');
    });
  });

  describe('scores', () => {
    it('renders scores with entries', () => {
      const view: JudgeDecisionView = {
        scores: { codeQuality: 9, testCoverage: 8 },
      };
      const result = renderJudgeDecision(view);
      expect(result).toContain('## Scores');
      expect(result).toContain('**Code Quality:** 9');
      expect(result).toContain('**Test Coverage:** 8');
    });

    it('omits scores section when scores is an empty object', () => {
      const view: JudgeDecisionView = { scores: {} };
      const result = renderJudgeDecision(view);
      expect(result).not.toContain('## Scores');
    });

    it('omits scores section when scores is absent', () => {
      const view: JudgeDecisionView = { verdict: 'approve' };
      const result = renderJudgeDecision(view);
      expect(result).not.toContain('## Scores');
    });
  });

  describe('conditions', () => {
    it('renders conditions when present', () => {
      const view: JudgeDecisionView = {
        conditions: ['Fix lint errors', 'Add unit tests'],
      };
      const result = renderJudgeDecision(view);
      expect(result).toContain('## Conditions');
      expect(result).toContain('- Fix lint errors');
      expect(result).toContain('- Add unit tests');
    });

    it('omits conditions section when conditions array is empty', () => {
      const view: JudgeDecisionView = { conditions: [] };
      const result = renderJudgeDecision(view);
      expect(result).not.toContain('## Conditions');
    });

    it('omits conditions section when conditions is absent', () => {
      const view: JudgeDecisionView = { verdict: 'approve' };
      const result = renderJudgeDecision(view);
      expect(result).not.toContain('## Conditions');
    });
  });

  describe('remaining fields', () => {
    it('renders remaining fields via renderObject', () => {
      const view = { notes: 'Follow up needed' } as unknown as JudgeDecisionView;
      const result = renderJudgeDecision(view);
      expect(result).toContain('Notes');
      expect(result).toContain('Follow up needed');
    });

    it('excludes verdict, decision, reasoning, rationale, scores, conditions, and metadata from remaining', () => {
      const view = {
        verdict: 'approve',
        decision: 'reject',
        reasoning: 'R1',
        rationale: 'R2',
        scores: { quality: 10 },
        conditions: ['C1'],
        id: 'jd-001',
        version: 1,
        extra: 'should appear',
      } as unknown as JudgeDecisionView;
      const result = renderJudgeDecision(view);
      expect(result).toContain('Extra');
      expect(result).toContain('should appear');
    });

    it('omits remaining section when no extra fields exist', () => {
      const view: JudgeDecisionView = { verdict: 'approve', reasoning: 'Good' };
      const result = renderJudgeDecision(view);
      const sections = result.split('\n\n');
      const lastSection = sections[sections.length - 1];
      expect(lastSection).toContain('Good');
    });
  });

  describe('full integration', () => {
    it('renders a complete judge decision with all fields', () => {
      const view = {
        verdict: 'approve_with_conditions',
        id: 'jd-099',
        version: 3,
        reasoning: 'Code meets quality standards but needs minor fixes',
        scores: { codeQuality: 8, testCoverage: 7, documentation: 6 },
        conditions: ['Fix typo in README', 'Add integration test'],
        additionalNotes: 'Great progress',
      } as unknown as JudgeDecisionView;
      const result = renderJudgeDecision(view);
      expect(result).toContain('# Judge Decision: approve_with_conditions');
      expect(result).toContain('**Id:** jd-099');
      expect(result).toContain('**Version:** 3');
      expect(result).toContain('## Reasoning');
      expect(result).toContain('Code meets quality standards but needs minor fixes');
      expect(result).toContain('## Scores');
      expect(result).toContain('**Code Quality:** 8');
      expect(result).toContain('**Test Coverage:** 7');
      expect(result).toContain('**Documentation:** 6');
      expect(result).toContain('## Conditions');
      expect(result).toContain('- Fix typo in README');
      expect(result).toContain('- Add integration test');
      expect(result).toContain('Additional Notes');
      expect(result).toContain('Great progress');
    });

    it('renders minimal decision with empty view', () => {
      const view: JudgeDecisionView = {};
      const result = renderJudgeDecision(view);
      expect(result).toBe('# Judge Decision');
    });

    it('sections are separated by double newlines', () => {
      const view: JudgeDecisionView = {
        verdict: 'approve',
        reasoning: 'Looks good',
        scores: { quality: 10 },
        conditions: ['None'],
      };
      const result = renderJudgeDecision(view);
      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(5);
    });
  });
});
