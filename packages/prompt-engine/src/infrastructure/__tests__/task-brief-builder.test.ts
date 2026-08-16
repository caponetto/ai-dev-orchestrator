import { describe, expect, it } from 'vitest';

import { buildTaskBrief } from '../task-brief-builder';

describe('buildTaskBrief', () => {
  it('builds a task brief with what, why, and derived success criteria', () => {
    const brief = buildTaskBrief({
      roleId: 'implementer',
      instructions: 'Implement the authentication endpoint',
      businessGoal: 'Allow users to securely log in',
      targetArtifactType: 'implementation',
    });

    expect(brief.what).toBe('Implement the authentication endpoint');
    expect(brief.why).toBe('Allow users to securely log in');
    expect(brief.successCriteria.length).toBeGreaterThan(0);
    expect(brief.successCriteria[0]?.id).toBeDefined();
    expect(brief.successCriteria[0]?.verifiable).toBeDefined();
  });

  it('includes optional how when provided', () => {
    const brief = buildTaskBrief({
      roleId: 'implementer',
      instructions: 'Implement login',
      businessGoal: 'Auth needed',
      targetArtifactType: 'implementation',
      approach: 'Use bcrypt for hashing',
    });

    expect(brief.how).toBe('Use bcrypt for hashing');
  });

  it('includes explicit success criteria alongside derived ones', () => {
    const brief = buildTaskBrief({
      roleId: 'static_reviewer',
      instructions: 'Review the code',
      businessGoal: 'Ensure code quality',
      targetArtifactType: 'static_review',
      explicitCriteria: [
        { id: 'custom-1', description: 'No security vulnerabilities', verifiable: true },
      ],
    });

    const ids = brief.successCriteria.map((c) => c.id);
    expect(ids).toContain('custom-1');
    expect(brief.successCriteria.length).toBeGreaterThan(1);
  });

  it('uses instructions as what and defaults why when businessGoal is empty', () => {
    const brief = buildTaskBrief({
      roleId: 'implementer',
      instructions: 'Fix the bug',
      businessGoal: '',
      targetArtifactType: 'implementation',
    });

    expect(brief.what).toBe('Fix the bug');
    expect(brief.why).toBe('Complete the assigned task successfully');
  });

  it('falls back to default criteria for unknown artifact types', () => {
    const brief = buildTaskBrief({
      roleId: 'implementer',
      instructions: 'Do something',
      businessGoal: 'Need it done',
      targetArtifactType: 'unknown_type',
    });

    expect(brief.successCriteria.length).toBeGreaterThan(0);
    expect(brief.successCriteria[0]?.id).toBe('default-complete');
  });
});
