import type { CanonicalSpecification, MergeStrategy } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { createSpecificationId } from '../../domain/types';
import { DefaultSpecificationMerger } from '../default-specification-merger';

function makeSpec(overrides: Partial<CanonicalSpecification> = {}): CanonicalSpecification {
  const now = new Date().toISOString();
  return {
    id: createSpecificationId(),
    version: 1,
    title: 'Feature A',
    businessGoal: 'Goal A',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const defaultStrategy: MergeStrategy = {
  scalarConflict: 'last-wins',
  arrayMerge: 'union',
  deduplication: true,
};

describe('DefaultSpecificationMerger', () => {
  const merger = new DefaultSpecificationMerger();

  it('returns an empty spec when given no specs', () => {
    const result = merger.merge([], defaultStrategy);
    expect(result.merged.title).toBe('');
    expect(result.conflicts).toHaveLength(0);
  });

  it('passes through a single spec', () => {
    const spec = makeSpec({ title: 'Solo' });
    const result = merger.merge([spec], defaultStrategy);
    expect(result.merged.title).toBe('Solo');
    expect(result.conflicts).toHaveLength(0);
  });

  it('merges two specs with no scalar conflicts', () => {
    const a = makeSpec({ title: 'Title', businessGoal: 'Goal' });
    const b = makeSpec({ title: 'Title', businessGoal: 'Goal' });
    const result = merger.merge([a, b], defaultStrategy);
    expect(result.merged.title).toBe('Title');
    expect(result.conflicts).toHaveLength(0);
  });

  it('uses last-wins for scalar conflicts', () => {
    const a = makeSpec({ title: 'Title A' });
    const b = makeSpec({ title: 'Title B' });
    const result = merger.merge([a, b], { ...defaultStrategy, scalarConflict: 'last-wins' });
    expect(result.merged.title).toBe('Title B');
    expect(result.conflicts.some((c) => c.field === 'title')).toBe(true);
    expect(result.conflicts[0].resolution).toBe('auto-resolved');
  });

  it('uses first-wins for scalar conflicts', () => {
    const a = makeSpec({ title: 'Title A' });
    const b = makeSpec({ title: 'Title B' });
    const result = merger.merge([a, b], { ...defaultStrategy, scalarConflict: 'first-wins' });
    expect(result.merged.title).toBe('Title A');
  });

  it('flags conflicts when strategy is flag-conflict', () => {
    const a = makeSpec({ title: 'Title A' });
    const b = makeSpec({ title: 'Title B' });
    const result = merger.merge([a, b], { ...defaultStrategy, scalarConflict: 'flag-conflict' });
    expect(result.conflicts.some((c) => c.resolution === 'flagged')).toBe(true);
  });

  it('deduplicates array items by ID', () => {
    const a = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
      ],
    });
    const b = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
        { id: 'FR2', title: 'B', description: 'B', priority: 'should', acceptanceCriteria: [] },
      ],
    });
    const result = merger.merge([a, b], defaultStrategy);
    expect(result.merged.functionalRequirements).toHaveLength(2);
  });

  it('concatenates arrays without dedup when configured', () => {
    const a = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
      ],
    });
    const b = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
      ],
    });
    const result = merger.merge([a, b], {
      ...defaultStrategy,
      arrayMerge: 'concatenate',
      deduplication: false,
    });
    expect(result.merged.functionalRequirements).toHaveLength(2);
  });

  it('merges source provenance from all specs', () => {
    const a = makeSpec({
      sources: [{ fetchedAt: '2025-01-01', checksum: 'a', fieldsMapped: ['title'] }],
    });
    const b = makeSpec({
      sources: [
        {
          fetchedAt: '2025-01-02',
          checksum: 'b',
          fieldsMapped: ['businessGoal'],
        },
      ],
    });
    const result = merger.merge([a, b], defaultStrategy);
    expect(result.merged.sources).toHaveLength(2);
  });

  it('flattens arrays without dedup when union + deduplication is false', () => {
    const a = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
      ],
    });
    const b = makeSpec({
      functionalRequirements: [
        { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
      ],
    });
    const result = merger.merge([a, b], {
      ...defaultStrategy,
      arrayMerge: 'union',
      deduplication: false,
    });
    expect(result.merged.functionalRequirements).toHaveLength(2);
  });

  it('deduplicates definitionOfDone strings when union + deduplication is true', () => {
    const a = makeSpec({ definitionOfDone: ['All tests pass', 'Code reviewed'] });
    const b = makeSpec({ definitionOfDone: ['All tests pass', 'Docs updated'] });
    const result = merger.merge([a, b], defaultStrategy);
    expect(result.merged.definitionOfDone).toHaveLength(3);
    expect(result.merged.definitionOfDone).toContain('All tests pass');
    expect(result.merged.definitionOfDone).toContain('Code reviewed');
    expect(result.merged.definitionOfDone).toContain('Docs updated');
  });

  it('does not deduplicate definitionOfDone strings when union + deduplication is false', () => {
    const a = makeSpec({ definitionOfDone: ['All tests pass'] });
    const b = makeSpec({ definitionOfDone: ['All tests pass'] });
    const result = merger.merge([a, b], {
      ...defaultStrategy,
      arrayMerge: 'union',
      deduplication: false,
    });
    expect(result.merged.definitionOfDone).toHaveLength(2);
  });

  it('concatenates definitionOfDone strings with concatenate strategy', () => {
    const a = makeSpec({ definitionOfDone: ['All tests pass'] });
    const b = makeSpec({ definitionOfDone: ['All tests pass'] });
    const result = merger.merge([a, b], {
      ...defaultStrategy,
      arrayMerge: 'concatenate',
    });
    expect(result.merged.definitionOfDone).toHaveLength(2);
  });
});
