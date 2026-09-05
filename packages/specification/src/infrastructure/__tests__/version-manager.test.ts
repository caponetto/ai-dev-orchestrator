import type { CanonicalSpecification } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { createSpecificationId } from '../../domain/types';
import { createNextVersion } from '../version-manager';

function makeSpec(): CanonicalSpecification {
  return {
    id: createSpecificationId('original-id'),
    version: 1,
    title: 'Original Title',
    businessGoal: 'Original Goal',
    stakeholders: [],
    assumptions: [],
    constraints: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    acceptanceCriteria: [],
    risks: [],
    dependencies: [],
    definitionOfDone: [],
    sources: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

describe('version manager', () => {
  it('increments version number', () => {
    const v2 = createNextVersion(makeSpec(), {});
    expect(v2.version).toBe(2);
  });

  it('sets previousVersion to the original spec id', () => {
    const original = makeSpec();
    const v2 = createNextVersion(original, {});
    expect(v2.previousVersion).toBe(original.id);
  });

  it('assigns a new id', () => {
    const original = makeSpec();
    const v2 = createNextVersion(original, {});
    expect(v2.id).not.toBe(original.id);
  });

  it('preserves createdAt from the original', () => {
    const original = makeSpec();
    const v2 = createNextVersion(original, {});
    expect(v2.createdAt).toBe(original.createdAt);
  });

  it('refreshes updatedAt', () => {
    const original = makeSpec();
    const v2 = createNextVersion(original, {});
    expect(v2.updatedAt).not.toBe(original.updatedAt);
  });

  it('applies partial updates', () => {
    const v2 = createNextVersion(makeSpec(), { title: 'Updated Title' });
    expect(v2.title).toBe('Updated Title');
    expect(v2.businessGoal).toBe('Original Goal');
  });

  it('chains versions correctly', () => {
    const v1 = makeSpec();
    const v2 = createNextVersion(v1, { title: 'V2' });
    const v3 = createNextVersion(v2, { title: 'V3' });
    expect(v3.version).toBe(3);
    expect(v3.previousVersion).toBe(v2.id);
  });
});
