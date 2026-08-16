import type { ArtifactSummary, WorkflowDefinition } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  deduplicateByType,
  dynamicParallelStatesFromDefinition,
  inferArtifactTypeFromFilename,
  parallelStatesFromDefinition,
  stateRolesFromDefinition,
  stateScriptsFromDefinition,
} from '../data-sources';

// ---------------------------------------------------------------------------
// Helper to build a minimal ArtifactSummary for tests
// ---------------------------------------------------------------------------

function makeArtifactSummary(
  overrides: Partial<ArtifactSummary> & Pick<ArtifactSummary, 'type' | 'version'>,
): ArtifactSummary {
  const type = overrides.type;
  const name = overrides.name ?? type;
  const version = overrides.version;
  return {
    ref: {
      type,
      name,
      version,
      checksum: 'abc123',
    },
    type,
    name,
    version,
    producedBy: overrides.producedBy ?? '',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    sizeBytes: overrides.sizeBytes ?? 100,
  };
}

// ---------------------------------------------------------------------------
// stateRolesFromDefinition
// ---------------------------------------------------------------------------

describe('stateRolesFromDefinition', () => {
  it('collects roles from dispatch_worker actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'planning',
      states: {
        planning: {
          type: 'initial',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect(result).toBeInstanceOf(Map);
    expect([...result.entries()]).toEqual([['planning', ['planner']]]);
  });

  it('collects roles from dispatch_parallel_workers actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'impl',
      states: {
        impl: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_parallel_workers', params: { roles: ['implementer', 'reviewer'] } },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect([...result.entries()]).toEqual([['impl', ['implementer', 'reviewer']]]);
  });

  it('merges roles from both dispatch types in the same state', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'mixed',
      states: {
        mixed: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_worker', params: { role: 'lead' } },
            { type: 'dispatch_parallel_workers', params: { roles: ['dev', 'qa'] } },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect([...result.entries()]).toEqual([['mixed', ['lead', 'dev', 'qa']]]);
  });

  it('returns an empty map when no states have entry actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'idle',
      states: {
        idle: {
          type: 'initial',
          transitions: [],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect(result.size).toBe(0);
  });

  it('skips entry actions of unrelated types', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'start',
      states: {
        start: {
          type: 'initial',
          transitions: [],
          entryActions: [
            { type: 'run_script', params: { script: 'setup.sh' } },
            { type: 'dispatch_worker', params: { role: 'architect' } },
            { type: 'notify', params: { channel: '#dev' } },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect([...result.entries()]).toEqual([['start', ['architect']]]);
  });

  it('extracts script names from run_script entry actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'publish',
      states: {
        publish: {
          type: 'action',
          transitions: [],
          entryActions: [{ type: 'run_script', params: { script: 'upload-findings-gist.ts' } }],
        },
        wrap: {
          type: 'action',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'writer' } }],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateScriptsFromDefinition(definition);

    expect([...result.entries()]).toEqual([['publish', ['upload-findings-gist.ts']]]);
  });

  it('handles multiple states each with their own roles', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'plan',
      states: {
        plan: {
          type: 'initial',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        },
        implement: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_parallel_workers', params: { roles: ['coder', 'tester'] } },
          ],
        },
        review: {
          type: 'work',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'reviewer' } }],
        },
        done: {
          type: 'final',
          transitions: [],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect(result.size).toBe(3);
    expect([...(result.get('plan') ?? [])]).toEqual(['planner']);
    expect([...(result.get('implement') ?? [])]).toEqual(['coder', 'tester']);
    expect([...(result.get('review') ?? [])]).toEqual(['reviewer']);
    expect(result.has('done')).toBe(false);
  });

  it('collects role from dispatch_dynamic_workers actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'authoring',
      states: {
        authoring: {
          type: 'action',
          transitions: [],
          entryActions: [
            {
              type: 'dispatch_dynamic_workers',
              params: {
                role: 'task_spec_writer',
                sourceArtifact: 'task_breakdown',
                itemsPath: 'tasks',
              },
            },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect([...result.entries()]).toEqual([['authoring', ['task_spec_writer']]]);
  });

  it('merges roles from dispatch_dynamic_workers with other dispatch types', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'mixed',
      states: {
        mixed: {
          type: 'action',
          transitions: [],
          entryActions: [
            { type: 'dispatch_worker', params: { role: 'analyst' } },
            {
              type: 'dispatch_dynamic_workers',
              params: { role: 'writer', sourceArtifact: 'breakdown', itemsPath: 'tasks' },
            },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = stateRolesFromDefinition(definition);

    expect([...result.entries()]).toEqual([['mixed', ['analyst', 'writer']]]);
  });
});

// ---------------------------------------------------------------------------
// parallelStatesFromDefinition
// ---------------------------------------------------------------------------

describe('parallelStatesFromDefinition', () => {
  it('returns an empty map when no dispatch_parallel_workers actions exist', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'start',
      states: {
        start: {
          type: 'initial',
          transitions: [],
          entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        },
        done: {
          type: 'final',
          transitions: [],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = parallelStatesFromDefinition(definition);

    expect(result.size).toBe(0);
  });

  it('returns an empty map when states have no entry actions', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'idle',
      states: {
        idle: {
          type: 'initial',
          transitions: [],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = parallelStatesFromDefinition(definition);

    expect(result.size).toBe(0);
  });

  it('returns map with parallel states when dispatch_parallel_workers present', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'impl',
      states: {
        impl: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_parallel_workers', params: { roles: ['coder', 'reviewer'] } },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = parallelStatesFromDefinition(definition);

    expect(result.size).toBe(1);
    expect([...(result.get('impl') ?? [])]).toEqual(['coder', 'reviewer']);
  });

  it('collects parallel states from multiple states', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'impl',
      states: {
        impl: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_parallel_workers', params: { roles: ['coder', 'tester'] } },
          ],
        },
        review: {
          type: 'work',
          transitions: [],
          entryActions: [
            { type: 'dispatch_parallel_workers', params: { roles: ['security', 'perf'] } },
          ],
        },
        done: {
          type: 'final',
          transitions: [],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = parallelStatesFromDefinition(definition);

    expect(result.size).toBe(2);
    expect([...(result.get('impl') ?? [])]).toEqual(['coder', 'tester']);
    expect([...(result.get('review') ?? [])]).toEqual(['security', 'perf']);
  });

  it('ignores dispatch_parallel_workers when roles is not an array', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'impl',
      states: {
        impl: {
          type: 'work',
          transitions: [],
          entryActions: [{ type: 'dispatch_parallel_workers', params: { roles: 'not-an-array' } }],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = parallelStatesFromDefinition(definition);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dynamicParallelStatesFromDefinition
// ---------------------------------------------------------------------------

describe('dynamicParallelStatesFromDefinition', () => {
  it('returns an empty map when no dispatch_dynamic_workers actions exist', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'intake',
      states: {
        intake: { type: 'initial', transitions: [] },
      },
    } as unknown as WorkflowDefinition;

    const result = dynamicParallelStatesFromDefinition(definition);

    expect(result.size).toBe(0);
  });

  it('extracts dynamic parallel states with their roles', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'intake',
      states: {
        intake: { type: 'initial', transitions: [] },
        spec_authoring: {
          type: 'action',
          transitions: [],
          entryActions: [
            {
              type: 'dispatch_dynamic_workers',
              params: { role: 'task_spec_writer', sourceArtifact: 'task_breakdown' },
            },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = dynamicParallelStatesFromDefinition(definition);

    expect(result.size).toBe(1);
    expect(result.get('spec_authoring')).toBe('task_spec_writer');
  });

  it('handles multiple states with dispatch_dynamic_workers', () => {
    const definition = {
      name: 'test',
      version: '1.0',
      initialState: 'intake',
      states: {
        intake: { type: 'initial', transitions: [] },
        spec_authoring: {
          type: 'action',
          transitions: [],
          entryActions: [
            {
              type: 'dispatch_dynamic_workers',
              params: { role: 'task_spec_writer', sourceArtifact: 'task_breakdown' },
            },
          ],
        },
        implementation: {
          type: 'action',
          transitions: [],
          entryActions: [
            {
              type: 'dispatch_dynamic_workers',
              params: { role: 'coder', sourceArtifact: 'task_specifications' },
            },
          ],
        },
      },
    } as unknown as WorkflowDefinition;

    const result = dynamicParallelStatesFromDefinition(definition);

    expect(result.size).toBe(2);
    expect(result.get('spec_authoring')).toBe('task_spec_writer');
    expect(result.get('implementation')).toBe('coder');
  });
});

// ---------------------------------------------------------------------------
// inferArtifactTypeFromFilename
// ---------------------------------------------------------------------------

describe('inferArtifactTypeFromFilename', () => {
  it('returns type for exact match', () => {
    expect(inferArtifactTypeFromFilename('intake_requirements')).toBe('intake_requirements');
  });

  it('returns type for exact match of other types', () => {
    expect(inferArtifactTypeFromFilename('plan')).toBe('plan');
    expect(inferArtifactTypeFromFilename('implementation')).toBe('implementation');
    expect(inferArtifactTypeFromFilename('verification')).toBe('verification');
    expect(inferArtifactTypeFromFilename('review_report')).toBe('review_report');
  });

  it('handles hyphen-to-underscore normalization', () => {
    expect(inferArtifactTypeFromFilename('intake-requirements')).toBe('intake_requirements');
    expect(inferArtifactTypeFromFilename('canonical-specification')).toBe(
      'canonical_specification',
    );
    expect(inferArtifactTypeFromFilename('review-report')).toBe('review_report');
  });

  it('returns type for name with underscore suffix', () => {
    expect(inferArtifactTypeFromFilename('plan_final')).toBe('plan');
    expect(inferArtifactTypeFromFilename('implementation_v2')).toBe('implementation');
  });

  it('returns type for name with dash suffix after normalization', () => {
    // After normalization, hyphens become underscores, so "code_review-final"
    // normalizes to "code_review_final" which starts with "code_review_"
    // But "code_review" is not in ARTIFACT_TYPES -- let's use a type that is
    expect(inferArtifactTypeFromFilename('plan-final')).toBe('plan');
  });

  it('returns undefined for unknown names', () => {
    expect(inferArtifactTypeFromFilename('random_file')).toBeUndefined();
    expect(inferArtifactTypeFromFilename('unknown')).toBeUndefined();
    expect(inferArtifactTypeFromFilename('my_document')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(inferArtifactTypeFromFilename('')).toBeUndefined();
  });

  it('returns type for review-related artifact types', () => {
    expect(inferArtifactTypeFromFilename('static_review')).toBe('static_review');
    expect(inferArtifactTypeFromFilename('security_review')).toBe('security_review');
    expect(inferArtifactTypeFromFilename('performance_review')).toBe('performance_review');
    expect(inferArtifactTypeFromFilename('adversarial_review')).toBe('adversarial_review');
  });

  it('returns type when filename matches a prefix with underscore delimiter', () => {
    expect(inferArtifactTypeFromFilename('test_plan_detailed')).toBe('test_plan');
    expect(inferArtifactTypeFromFilename('release_summary_final')).toBe('release_summary');
  });

  it('handles names with all hyphens normalized to underscores', () => {
    expect(inferArtifactTypeFromFilename('judge-decision')).toBe('judge_decision');
    expect(inferArtifactTypeFromFilename('review-report')).toBe('review_report');
  });
});

// ---------------------------------------------------------------------------
// deduplicateByType
// ---------------------------------------------------------------------------

describe('deduplicateByType', () => {
  it('returns empty array for empty input', () => {
    const result = deduplicateByType([]);

    expect(result).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const artifact = makeArtifactSummary({ type: 'plan', version: 1 });
    const result = deduplicateByType([artifact]);

    expect(result).toEqual([artifact]);
  });

  it('deduplicates by type/version keeping first occurrence', () => {
    const first = makeArtifactSummary({
      type: 'plan',
      version: 1,
      producedBy: 'first-agent',
    });
    const duplicate = makeArtifactSummary({
      type: 'plan',
      version: 1,
      producedBy: 'second-agent',
    });

    const result = deduplicateByType([first, duplicate]);

    expect(result).toHaveLength(1);
    expect(result[0].producedBy).toBe('first-agent');
  });

  it('keeps artifacts with different versions', () => {
    const v1 = makeArtifactSummary({ type: 'plan', version: 1 });
    const v2 = makeArtifactSummary({ type: 'plan', version: 2 });

    const result = deduplicateByType([v1, v2]);

    expect(result).toHaveLength(2);
    expect(result[0].version).toBe(1);
    expect(result[1].version).toBe(2);
  });

  it('keeps artifacts with different types', () => {
    const plan = makeArtifactSummary({ type: 'plan', version: 1 });
    const impl = makeArtifactSummary({ type: 'implementation', version: 1 });

    const result = deduplicateByType([plan, impl]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('plan');
    expect(result[1].type).toBe('implementation');
  });

  it('deduplicates across a mix of types and versions', () => {
    const artifacts = [
      makeArtifactSummary({ type: 'plan', version: 1, producedBy: 'a' }),
      makeArtifactSummary({ type: 'implementation', version: 1, producedBy: 'b' }),
      makeArtifactSummary({ type: 'plan', version: 1, producedBy: 'c' }), // duplicate
      makeArtifactSummary({ type: 'plan', version: 2, producedBy: 'd' }),
      makeArtifactSummary({ type: 'implementation', version: 1, producedBy: 'e' }), // duplicate
    ];

    const result = deduplicateByType(artifacts);

    expect(result).toHaveLength(3);
    expect(result.map((a) => `${a.type}/v${String(a.version)}/${a.producedBy}`)).toEqual([
      'plan/v1/a',
      'implementation/v1/b',
      'plan/v2/d',
    ]);
  });
});
