import type { ArtifactType } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultArtifactTypeValidator } from '../artifact-type-validator';

const validator = new DefaultArtifactTypeValidator();

function frontmatter(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields).map(([k, v]) => {
    if (Array.isArray(v)) {
      return `${k}: []`;
    }
    if (typeof v === 'object' && v !== null) {
      return `${k}:\n  type: "${(v as Record<string, string>).type}"\n  name: "${(v as Record<string, string>).name}"`;
    }
    return `${k}: ${typeof v === 'string' ? `"${v}"` : String(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n# Body content`;
}

describe('DefaultArtifactTypeValidator', () => {
  describe('canonical_specification', () => {
    it('validates valid frontmatter', () => {
      const content = frontmatter({
        id: 'abc-123',
        version: 1,
        title: 'Test Spec',
        businessGoal: 'Test goal',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });
      expect(validator.validate('canonical_specification', content).valid).toBe(true);
    });

    it('rejects missing required fields', () => {
      const content = frontmatter({ id: 'abc-123', version: 1 });
      const result = validator.validate('canonical_specification', content);
      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('plan', () => {
    it('validates valid plan', () => {
      const content = JSON.stringify({
        version: 1,
        specificationRef: { type: 'canonical_specification', name: 'spec' },
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Implement feature X',
        tasks: [
          {
            taskId: 'task-1',
            description: 'Add endpoint',
            files: ['src/api.ts'],
            dependencies: [],
          },
        ],
      });
      expect(validator.validate('plan', content).valid).toBe(true);
    });

    it('rejects missing specificationRef', () => {
      const content = JSON.stringify({
        version: 1,
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Plan',
        tasks: [{ taskId: 't1', description: 'd', files: [], dependencies: [] }],
      });
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(false);
    });
  });

  describe('review types', () => {
    const reviewTypes: ArtifactType[] = [
      'plan_review',
      'static_review',
      'security_review',
      'performance_review',
    ];

    it.each(reviewTypes)('validates valid %s', (type) => {
      const content = frontmatter({
        version: 1,
        approved: true,
        summary: 'Looks good overall',
        findings: [],
        createdAt: '2025-01-15T10:00:00Z',
      });
      expect(validator.validate(type, content).valid).toBe(true);
    });

    it('rejects missing summary field', () => {
      const content = frontmatter({
        version: 1,
        approved: true,
        findings: [],
        createdAt: '2025-01-15T10:00:00Z',
      });
      expect(validator.validate('plan_review', content).valid).toBe(false);
    });

    it('rejects missing findings field', () => {
      const content = frontmatter({
        version: 1,
        approved: false,
        summary: 'Issues found',
        createdAt: '2025-01-15T10:00:00Z',
      });
      expect(validator.validate('plan_review', content).valid).toBe(false);
    });
  });

  describe('agreement types', () => {
    const agreementTypes: ArtifactType[] = [
      'planning_agreement',
      'implementation_agreement',
      'verification_agreement',
      'release_agreement',
    ];

    it.each(agreementTypes)('validates valid %s', (type) => {
      const content = frontmatter({
        version: 1,
        agreementType: type,
        runId: 'run-123',
        stageId: 'PLAN_REVIEW',
        createdAt: '2025-01-15T10:00:00Z',
        approvalStatus: 'approved',
        approvalType: 'human',
      });
      expect(validator.validate(type, content).valid).toBe(true);
    });
  });

  describe('content without frontmatter', () => {
    it('rejects content that is neither frontmatter nor JSON', () => {
      const result = validator.validate('plan', 'just plain text without frontmatter');
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]?.message).toContain('not valid frontmatter or JSON');
    });
  });

  describe('JSON content (agent-produced artifacts)', () => {
    it('validates valid JSON review artifact', () => {
      const content = JSON.stringify({
        version: 1,
        approved: false,
        summary: 'Found issues',
        findings: [
          { id: 'f1', category: 'correctness', severity: 'major', description: 'Bad naming' },
        ],
        reviewType: 'static_review',
        reviewedArtifactRef: {},
        role: 'static_reviewer',
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validator.validate('static_review', content);
      expect(result.valid).toBe(true);
    });

    it('validates valid JSON verification artifact', () => {
      const content = JSON.stringify({
        version: 1,
        passed: true,
        summary: 'All tests pass',
        failures: [],
        implementationRef: {},
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validator.validate('verification', content);
      expect(result.valid).toBe(true);
    });

    it('validates valid JSON judge_decision artifact', () => {
      const content = JSON.stringify({
        version: 1,
        approved: true,
        rationale: 'Implementation meets requirements',
        directives: ['merge when ready'],
        reviewArtifactsConsidered: ['review-v1'],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validator.validate('judge_decision', content);
      expect(result.valid).toBe(true);
    });

    it('rejects JSON missing required fields', () => {
      const content = JSON.stringify({ version: 1 });
      const result = validator.validate('static_review', content);
      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('rejects JSON arrays', () => {
      const content = JSON.stringify([1, 2, 3]);
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(false);
    });
  });

  describe('plan semantic validation at storage time', () => {
    it('rejects plan with duplicate taskIds', () => {
      const content = JSON.stringify({
        version: 1,
        specificationRef: { type: 'canonical_specification', name: 'spec' },
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Duplicate IDs',
        tasks: [
          { taskId: 't1', description: 'Task 1', files: [], dependencies: [] },
          { taskId: 't1', description: 'Task 2', files: [], dependencies: [] },
        ],
      });
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('duplicate taskId'))).toBe(true);
    });

    it('rejects plan with dependency cycle', () => {
      const content = JSON.stringify({
        version: 1,
        specificationRef: { type: 'canonical_specification', name: 'spec' },
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Cyclic plan',
        tasks: [
          { taskId: 't1', description: 'Task 1', files: [], dependencies: ['t2'] },
          { taskId: 't2', description: 'Task 2', files: [], dependencies: ['t1'] },
        ],
      });
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('cycle'))).toBe(true);
    });

    it('rejects plan with dangling dependency', () => {
      const content = JSON.stringify({
        version: 1,
        specificationRef: { type: 'canonical_specification', name: 'spec' },
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Dangling dep',
        tasks: [{ taskId: 't1', description: 'Task 1', files: [], dependencies: ['t99'] }],
      });
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.message.includes('unknown dependency'))).toBe(true);
    });

    it('passes valid plan with dependencies', () => {
      const content = JSON.stringify({
        version: 1,
        specificationRef: { type: 'canonical_specification', name: 'spec' },
        createdAt: '2025-01-15T10:00:00Z',
        summary: 'Valid plan',
        tasks: [
          { taskId: 't1', description: 'Task 1', files: ['a.ts'], dependencies: [] },
          { taskId: 't2', description: 'Task 2', files: ['b.ts'], dependencies: ['t1'] },
        ],
      });
      const result = validator.validate('plan', content);
      expect(result.valid).toBe(true);
    });
  });

  describe('judge_decision with planLevelIssue', () => {
    it('validates judge_decision with planLevelIssue: true', () => {
      const content = JSON.stringify({
        version: 1,
        approved: false,
        rationale: 'Plan needs rework',
        directives: ['Redesign'],
        reviewArtifactsConsidered: ['r1'],
        planLevelIssue: true,
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validator.validate('judge_decision', content);
      expect(result.valid).toBe(true);
    });

    it('validates judge_decision without planLevelIssue (optional)', () => {
      const content = JSON.stringify({
        version: 1,
        approved: true,
        rationale: 'Looks good',
        directives: [],
        reviewArtifactsConsidered: ['r1'],
        createdAt: '2026-01-01T00:00:00Z',
      });
      const result = validator.validate('judge_decision', content);
      expect(result.valid).toBe(true);
    });
  });

  describe('getSchema', () => {
    it('returns schema for known types', () => {
      expect(validator.getSchema('plan')).not.toBeNull();
      expect(validator.getSchema('canonical_specification')).not.toBeNull();
    });
  });
});
