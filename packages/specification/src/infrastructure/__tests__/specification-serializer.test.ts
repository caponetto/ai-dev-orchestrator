import type { CanonicalSpecification } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { createSpecificationId } from '../../domain/types';
import { deserializeSpecification, serializeSpecification } from '../specification-serializer';

function makeSpec(overrides: Partial<CanonicalSpecification> = {}): CanonicalSpecification {
  return {
    id: createSpecificationId('test-spec-id'),
    version: 1,
    title: 'Test Feature',
    businessGoal: 'Increase retention',
    stakeholders: [{ name: 'PM', role: 'Owner', interest: 'Retention metrics' }],
    assumptions: [{ id: 'A1', description: 'Users have email', impact: 'high', validated: false }],
    constraints: [{ id: 'C1', description: 'Use REST API', type: 'technical', source: 'CTO' }],
    functionalRequirements: [
      {
        id: 'FR1',
        title: 'Login',
        description: 'User can log in',
        priority: 'must',
        acceptanceCriteria: ['User sees dashboard'],
      },
    ],
    nonFunctionalRequirements: [
      { id: 'NFR1', title: 'Speed', description: 'Fast response', category: 'performance' },
    ],
    acceptanceCriteria: [
      {
        id: 'AC1',
        description: 'Login works',
        verificationMethod: 'test',
        requirementIds: ['FR1'],
      },
    ],
    risks: [{ id: 'R1', description: 'Downtime', likelihood: 'low', impact: 'high' }],
    dependencies: [
      { id: 'D1', description: 'Auth service', type: 'external', status: 'available' },
    ],
    definitionOfDone: ['All tests pass', 'Code reviewed'],
    sources: [
      {
        fetchedAt: '2025-01-15T10:00:00Z',
        checksum: 'sha256:abc',
        fieldsMapped: ['title'],
      },
    ],
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('specification serializer', () => {
  it('serializes and produces valid markdown with frontmatter', () => {
    const spec = makeSpec();
    const serialized = serializeSpecification(spec);
    expect(serialized.startsWith('---')).toBe(true);
    expect(serialized).toContain('title:');
    expect(serialized).toContain('## Stakeholders');
    expect(serialized).toContain('## Functional Requirements');
  });

  it('preserves core frontmatter fields through round-trip', () => {
    const spec = makeSpec();
    const serialized = serializeSpecification(spec);
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.id).toBe(spec.id);
    expect(deserialized.version).toBe(spec.version);
    expect(deserialized.title).toBe(spec.title);
    expect(deserialized.businessGoal).toBe(spec.businessGoal);
    expect(deserialized.createdAt).toBe(spec.createdAt);
    expect(deserialized.updatedAt).toBe(spec.updatedAt);
  });

  it('preserves source provenance through round-trip', () => {
    const spec = makeSpec();
    const serialized = serializeSpecification(spec);
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.sources).toHaveLength(1);
    expect(deserialized.sources[0].checksum).toBe('sha256:abc');
  });

  it('preserves analysis through round-trip', () => {
    const spec = makeSpec({
      analysis: {
        completenessScore: 0.85,
        ambiguityCount: 2,
        riskCount: 1,
        unvalidatedAssumptionCount: 1,
        readinessVerdict: 'Ready',
      },
    });
    const serialized = serializeSpecification(spec);
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.analysis).toBeDefined();
    expect(deserialized.analysis?.completenessScore).toBe(0.85);
    expect(deserialized.analysis?.readinessVerdict).toBe('Ready');
  });

  it('handles empty optional fields', () => {
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
      sources: [],
    });
    const serialized = serializeSpecification(spec);
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.title).toBe(spec.title);
    expect(deserialized.sources).toHaveLength(0);
  });

  it('throws on content without frontmatter delimiters', () => {
    expect(() => deserializeSpecification('no frontmatter here')).toThrow(
      'missing YAML frontmatter',
    );
  });

  it('serializes previousVersion when present', () => {
    const spec = makeSpec({ previousVersion: 'v0.9.0' });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('previousVersion:');
    expect(serialized).toContain('v0.9.0');
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.previousVersion).toBe('v0.9.0');
  });

  it('serializes extensions when non-empty', () => {
    const spec = makeSpec({ extensions: { customTool: 'jest', coverage: 80 } });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('extensions:');
    expect(serialized).toContain('customTool');
    const deserialized = deserializeSpecification(serialized);
    expect(deserialized.extensions).toEqual({ customTool: 'jest', coverage: 80 });
  });

  it('omits extensions from frontmatter when empty object', () => {
    const spec = makeSpec({ extensions: {} });
    const serialized = serializeSpecification(spec);
    expect(serialized).not.toContain('extensions:');
  });

  it('serializes NFR metric and threshold when present', () => {
    const spec = makeSpec({
      nonFunctionalRequirements: [
        {
          id: 'NFR1',
          title: 'Response Time',
          description: 'API responds quickly',
          category: 'performance',
          metric: 'p99 latency',
          threshold: '<200ms',
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('Metric: p99 latency');
    expect(serialized).toContain('Threshold: <200ms');
  });

  it('serializes NFR without metric or threshold', () => {
    const spec = makeSpec({
      nonFunctionalRequirements: [
        {
          id: 'NFR1',
          title: 'Speed',
          description: 'Fast response',
          category: 'performance',
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).not.toContain('Metric:');
    expect(serialized).not.toContain('Threshold:');
  });

  it('serializes risk mitigation when present', () => {
    const spec = makeSpec({
      risks: [
        {
          id: 'R1',
          description: 'Service outage',
          likelihood: 'medium',
          impact: 'high',
          mitigation: 'Deploy redundant instances',
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('Mitigation: Deploy redundant instances');
  });

  it('serializes dependency owner when present', () => {
    const spec = makeSpec({
      dependencies: [
        {
          id: 'D1',
          description: 'Auth service',
          type: 'external',
          status: 'available',
          owner: 'Platform Team',
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('Owner: Platform Team');
  });

  it('serializes functional requirement dependencies when present', () => {
    const spec = makeSpec({
      functionalRequirements: [
        {
          id: 'FR1',
          title: 'Login',
          description: 'User can log in',
          priority: 'must',
          acceptanceCriteria: ['User sees dashboard'],
          dependencies: ['FR2', 'FR3'],
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).toContain('Dependencies: FR2, FR3');
  });

  it('omits FR dependencies line when dependencies array is empty', () => {
    const spec = makeSpec({
      functionalRequirements: [
        {
          id: 'FR1',
          title: 'Login',
          description: 'User can log in',
          priority: 'must',
          acceptanceCriteria: ['User sees dashboard'],
          dependencies: [],
        },
      ],
    });
    const serialized = serializeSpecification(spec);
    expect(serialized).not.toContain('Dependencies:');
  });
});
