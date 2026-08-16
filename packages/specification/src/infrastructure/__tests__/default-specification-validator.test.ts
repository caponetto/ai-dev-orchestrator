import type { CanonicalSpecification } from '@ai-orchestrator/schemas';
import { COMPLETENESS_WEIGHTS } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { createSpecificationId } from '../../domain/types';
import { DefaultSpecificationValidator } from '../default-specification-validator';

function makeSpec(overrides: Partial<CanonicalSpecification> = {}): CanonicalSpecification {
  const now = new Date().toISOString();
  return {
    id: createSpecificationId(),
    version: 1,
    title: 'Test Feature',
    businessGoal: 'Increase user retention',
    stakeholders: [{ name: 'PM', role: 'Owner', interest: 'Retention' }],
    assumptions: [{ id: 'A1', description: 'Users have email', impact: 'high', validated: true }],
    constraints: [{ id: 'C1', description: 'Must use REST', type: 'technical', source: 'CTO' }],
    functionalRequirements: [
      {
        id: 'FR1',
        title: 'Login',
        description: 'User can log in',
        priority: 'must',
        acceptanceCriteria: ['AC: user sees dashboard after login'],
      },
    ],
    nonFunctionalRequirements: [
      { id: 'NFR1', title: 'Perf', description: 'Fast', category: 'performance' },
    ],
    acceptanceCriteria: [
      {
        id: 'AC1',
        description: 'Login works',
        verificationMethod: 'test',
        requirementIds: ['FR1'],
      },
    ],
    risks: [{ id: 'R1', description: 'API down', likelihood: 'low', impact: 'high' }],
    dependencies: [
      { id: 'D1', description: 'Auth service', type: 'external', status: 'available' },
    ],
    definitionOfDone: ['All tests pass'],
    sources: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DefaultSpecificationValidator', () => {
  const validator = new DefaultSpecificationValidator();

  describe('validateStructure', () => {
    it('passes for a valid specification', () => {
      const result = validator.validateStructure(makeSpec());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when title is empty', () => {
      const result = validator.validateStructure(makeSpec({ title: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    it('fails when businessGoal is empty', () => {
      const result = validator.validateStructure(makeSpec({ businessGoal: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'businessGoal')).toBe(true);
    });

    it('warns when no functional requirements exist', () => {
      const result = validator.validateStructure(makeSpec({ functionalRequirements: [] }));
      expect(result.warnings.some((w) => w.field === 'functionalRequirements')).toBe(true);
    });

    it('fails when version is zero', () => {
      const result = validator.validateStructure(makeSpec({ version: 0 }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'version')).toBe(true);
    });
  });

  describe('validateSemantics', () => {
    it('passes for a valid specification', () => {
      const result = validator.validateSemantics(makeSpec());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails on duplicate functional requirement IDs', () => {
      const spec = makeSpec({
        functionalRequirements: [
          { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
          { id: 'FR1', title: 'B', description: 'B', priority: 'should', acceptanceCriteria: [] },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.rule === 'unique-id')).toBe(true);
    });

    it('fails when acceptance criterion references non-existent requirement', () => {
      const spec = makeSpec({
        acceptanceCriteria: [
          { id: 'AC1', description: 'Test', verificationMethod: 'test', requirementIds: ['FR99'] },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.rule === 'valid-reference')).toBe(true);
    });

    it('fails on self-referencing requirement dependency', () => {
      const spec = makeSpec({
        functionalRequirements: [
          {
            id: 'FR1',
            title: 'A',
            description: 'A',
            priority: 'must',
            acceptanceCriteria: [],
            dependencies: ['FR1'],
          },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.rule === 'no-self-reference')).toBe(true);
    });

    it('warns when no "must" priority requirements exist', () => {
      const spec = makeSpec({
        functionalRequirements: [
          { id: 'FR1', title: 'A', description: 'A', priority: 'should', acceptanceCriteria: [] },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.warnings.some((w) => w.field === 'functionalRequirements')).toBe(true);
    });

    it('fails on duplicate non-functional requirement IDs', () => {
      const spec = makeSpec({
        nonFunctionalRequirements: [
          { id: 'NFR1', title: 'A', description: 'A', category: 'performance' },
          { id: 'NFR1', title: 'B', description: 'B', category: 'security' },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'nonFunctionalRequirements' && e.rule === 'unique-id',
        ),
      ).toBe(true);
    });

    it('fails on duplicate acceptance criteria IDs', () => {
      const spec = makeSpec({
        acceptanceCriteria: [
          { id: 'AC1', description: 'X', verificationMethod: 'test', requirementIds: ['FR1'] },
          { id: 'AC1', description: 'Y', verificationMethod: 'review', requirementIds: ['FR1'] },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'acceptanceCriteria' && e.rule === 'unique-id'),
      ).toBe(true);
    });

    it('fails on duplicate risk IDs', () => {
      const spec = makeSpec({
        risks: [
          { id: 'R1', description: 'Risk A', likelihood: 'low', impact: 'high' },
          { id: 'R1', description: 'Risk B', likelihood: 'medium', impact: 'low' },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'risks' && e.rule === 'unique-id')).toBe(true);
    });

    it('fails on duplicate dependency IDs', () => {
      const spec = makeSpec({
        dependencies: [
          { id: 'D1', description: 'Dep A', type: 'external', status: 'available' },
          { id: 'D1', description: 'Dep B', type: 'internal', status: 'pending' },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'dependencies' && e.rule === 'unique-id')).toBe(
        true,
      );
    });

    it('fails on duplicate assumption IDs', () => {
      const spec = makeSpec({
        assumptions: [
          { id: 'A1', description: 'Assumption A', impact: 'high', validated: true },
          { id: 'A1', description: 'Assumption B', impact: 'low', validated: false },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'assumptions' && e.rule === 'unique-id')).toBe(
        true,
      );
    });

    it('fails on duplicate constraint IDs', () => {
      const spec = makeSpec({
        constraints: [
          { id: 'C1', description: 'Constraint A', type: 'technical', source: 'CTO' },
          { id: 'C1', description: 'Constraint B', type: 'business', source: 'VP' },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'constraints' && e.rule === 'unique-id')).toBe(
        true,
      );
    });

    it('warns when FR depends on unknown requirement', () => {
      const spec = makeSpec({
        functionalRequirements: [
          {
            id: 'FR1',
            title: 'A',
            description: 'A',
            priority: 'must',
            acceptanceCriteria: [],
            dependencies: ['FR99'],
          },
        ],
      });
      const result = validator.validateSemantics(spec);
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === 'functionalRequirements' && w.message.includes('unknown requirement FR99'),
        ),
      ).toBe(true);
    });
  });

  describe('validateCompleteness', () => {
    it('scores a fully complete spec at 1.0', () => {
      const result = validator.validateCompleteness(makeSpec());
      expect(result.score).toBe(1);
      expect(result.missingFields).toHaveLength(0);
      expect(result.emptyFields).toHaveLength(0);
    });

    it('scores empty arrays as 0.0', () => {
      const spec = makeSpec({
        stakeholders: [],
        assumptions: [],
        constraints: [],
        functionalRequirements: [],
        nonFunctionalRequirements: [],
        acceptanceCriteria: [],
        risks: [],
        dependencies: [],
        definitionOfDone: [],
      });
      const result = validator.validateCompleteness(spec);
      expect(result.score).toBeLessThan(1);
      expect(result.emptyFields).toContain('stakeholders');
      expect(result.emptyFields).toContain('functionalRequirements');
    });

    it('scores requirements without acceptance criteria as 0.5', () => {
      const spec = makeSpec({
        functionalRequirements: [
          { id: 'FR1', title: 'A', description: 'A', priority: 'must', acceptanceCriteria: [] },
        ],
      });
      const result = validator.validateCompleteness(spec);
      expect(result.fieldScores['functionalRequirements']).toBe(0.5);
    });

    it('reports empty string fields as empty', () => {
      const spec = makeSpec({ title: '', businessGoal: '' });
      const result = validator.validateCompleteness(spec);
      expect(result.emptyFields).toContain('title');
      expect(result.emptyFields).toContain('businessGoal');
      expect(result.fieldScores['title']).toBe(0);
      expect(result.fieldScores['businessGoal']).toBe(0);
    });

    it('reports missing (undefined) fields', () => {
      const spec = makeSpec();
      // Force a field to undefined to exercise the null/undefined branch
      const specWithMissing = { ...spec, title: undefined } as unknown as CanonicalSpecification;
      const result = validator.validateCompleteness(specWithMissing);
      expect(result.missingFields).toContain('title');
      expect(result.fieldScores['title']).toBe(0);
    });

    it('scores non-string non-array values as 1.0', () => {
      const spec = makeSpec();
      // Force a field to a number to exercise the fallback branch
      const specWithNumber = { ...spec, title: 42 } as unknown as CanonicalSpecification;
      const result = validator.validateCompleteness(specWithNumber);
      expect(result.fieldScores['title']).toBe(1);
    });

    it('field weights sum to 1.0', () => {
      const sum = Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 100) / 100).toBe(1);
    });
  });
});
