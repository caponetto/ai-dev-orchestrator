import { describe, expect, it } from 'vitest';

import {
  artifactFlowDefinitionSchema,
  roleInteractionRelationshipSchema,
  roleInteractionSchema,
  visibilityCheckSchema,
} from '../collaboration-model';

describe('roleInteractionRelationshipSchema', () => {
  it.each(['produces_for', 'reviews', 'approves'])('accepts "%s"', (val) => {
    expect(roleInteractionRelationshipSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid relationship', () => {
    expect(roleInteractionRelationshipSchema.safeParse('depends_on').success).toBe(false);
  });
});

describe('roleInteractionSchema', () => {
  it('validates a role interaction', () => {
    const data = {
      producerRole: 'implementer',
      consumerRole: 'reviewer',
      artifactType: 'implementation',
      relationship: 'produces_for',
    };
    expect(roleInteractionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid artifact type', () => {
    const data = {
      producerRole: 'a',
      consumerRole: 'b',
      artifactType: 'invalid',
      relationship: 'reviews',
    };
    expect(roleInteractionSchema.safeParse(data).success).toBe(false);
  });
});

describe('artifactFlowDefinitionSchema', () => {
  it('validates an artifact flow', () => {
    const data = {
      artifactType: 'plan',
      producedBy: 'architect',
      consumedBy: ['implementer'],
      reviewedBy: ['reviewer'],
    };
    expect(artifactFlowDefinitionSchema.safeParse(data).success).toBe(true);
  });

  it('validates with empty arrays', () => {
    const data = {
      artifactType: 'implementation',
      producedBy: 'implementer',
      consumedBy: [],
      reviewedBy: [],
    };
    expect(artifactFlowDefinitionSchema.safeParse(data).success).toBe(true);
  });
});

describe('visibilityCheckSchema', () => {
  it('validates an allowed check', () => {
    const data = { allowed: true, reason: 'Role has read access' };
    expect(visibilityCheckSchema.safeParse(data).success).toBe(true);
  });

  it('validates a denied check', () => {
    const data = { allowed: false, reason: 'Artifact is forbidden' };
    expect(visibilityCheckSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing reason', () => {
    expect(visibilityCheckSchema.safeParse({ allowed: true }).success).toBe(false);
  });
});
