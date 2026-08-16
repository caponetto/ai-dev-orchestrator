import type {
  ArtifactStore,
  CodeIntelligence,
  DependencyGraph,
  PromptEngine,
  RoleRegistry,
} from '@ai-orchestrator/ports';
import { createRunId } from '@ai-orchestrator/ports';
import type { Artifact } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { ContextAssemblyError } from '../../../domain/runner-system/errors';
import { RunnerContextAssembler } from '../runner-context-assembler';

function makeArtifactStore(): ArtifactStore {
  return {
    store: vi.fn(),
    get: vi.fn().mockResolvedValue({
      ref: { type: 'implementation', name: 'src-1', version: 1, checksum: 'abc' },
      type: 'implementation',
      name: 'src-1',
      version: 1,
      checksum: 'abc',
      content: 'const x = 1;',
      producedBy: 'developer',
      createdAt: '2024-01-01T00:00:00Z',
      sizeBytes: 12,
      metadata: {},
    } satisfies Artifact),
    getLatest: vi.fn(),
    list: vi.fn(),
    history: vi.fn(),
    verify: vi.fn(),
    inventory: vi.fn(),
  };
}

function makeRoleRegistry(): RoleRegistry {
  return {
    getRole: vi.fn().mockReturnValue({
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation', 'plan'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: ['code_generation'],
      dispatchType: 'agent',
    }),
    listRoles: vi.fn().mockReturnValue([]),
    getModelAssignment: vi.fn().mockReturnValue({
      roleId: 'architect',
      model: 'claude-3',
      maxTokens: 4096,
    }),
    getRecommendedModel: vi.fn().mockReturnValue({
      roleId: 'architect',
      model: 'claude-3',
      maxTokens: 4096,
    }),
    getNextTier: vi.fn().mockReturnValue(null),
    validate: vi.fn(),
  };
}

function makePromptEngine(): PromptEngine {
  return {
    render: vi.fn().mockResolvedValue({
      text: 'Rendered prompt',
      templateRef: { role: 'architect', version: '1.0', source: 'built-in' },
      tokenEstimate: 50,
      truncations: [],
      outputContract: {
        role: 'architect',
        artifactType: 'static_review',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
      metadata: {
        templateVersion: '1.0',
        resolvedFrom: 'architect.md',
        renderedAt: '2024-01-01T00:00:00Z',
        inputArtifactRefs: [],
        variablesUsed: [],
        partialsIncluded: [],
      },
    }),
    validateOutput: vi.fn(),
    validateTemplate: vi.fn(),
  };
}

describe('RunnerContextAssembler', () => {
  it('assembles worker context from dispatch request', async () => {
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
    );

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [{ type: 'implementation', name: 'src-1', version: 1, checksum: 'abc' }],
    });

    expect(context.role.name).toBe('architect');
    expect(context.prompt).toContain('Rendered prompt');
    expect(context.prompt).toContain('## Task Brief');
    expect(context.inputArtifacts).toHaveLength(1);
    expect(context.modelAssignment.model).toBe('claude-3');
  });

  it('throws ContextAssemblyError when role not found', async () => {
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const assembler = new RunnerContextAssembler(makeArtifactStore(), registry, makePromptEngine());

    await expect(
      assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'unknown',
        inputArtifacts: [],
      }),
    ).rejects.toThrow(ContextAssemblyError);
  });

  it('throws ContextAssemblyError when artifact not found', async () => {
    const store = makeArtifactStore();
    (store.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not found'));

    const assembler = new RunnerContextAssembler(store, makeRoleRegistry(), makePromptEngine());

    await expect(
      assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [{ type: 'implementation', name: 'missing', version: 1, checksum: 'abc' }],
      }),
    ).rejects.toThrow(ContextAssemblyError);
  });

  it('throws ContextAssemblyError when role lacks read access', async () => {
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
    });

    const assembler = new RunnerContextAssembler(makeArtifactStore(), registry, makePromptEngine());

    await expect(
      assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [{ type: 'implementation', name: 'src-1', version: 1, checksum: 'abc' }],
      }),
    ).rejects.toThrow(ContextAssemblyError);
  });

  it('uses model override from dispatch request', async () => {
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
    );

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
      overrides: {
        model: {
          roleId: 'architect',
          model: 'gpt-4',
        },
      },
    });

    expect(context.modelAssignment.model).toBe('gpt-4');
  });

  it('handles empty input artifacts', async () => {
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
    );

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(context.inputArtifacts).toHaveLength(0);
  });

  it('resolves prior owned artifacts when dispatch has empty inputArtifacts', async () => {
    const intakeRef = {
      type: 'intake_requirements' as const,
      name: 'intake-requirements',
      version: 1,
      checksum: 'intake-1',
    };
    const priorSpecRef = {
      type: 'canonical_specification' as const,
      name: 'requirements_analyst-output',
      version: 1,
      checksum: 'spec-1',
    };

    const store = makeArtifactStore();
    (store.list as ReturnType<typeof vi.fn>).mockImplementation(({ type }: { type: string }) => {
      if (type === 'intake_requirements') {
        return [intakeRef];
      }
      if (type === 'canonical_specification') {
        return [priorSpecRef];
      }
      return [];
    });
    (store.get as ReturnType<typeof vi.fn>).mockImplementation((ref: typeof intakeRef) => ({
      ref,
      type: ref.type,
      name: ref.name,
      version: ref.version,
      checksum: ref.checksum,
      content: `${ref.type}-content`,
      producedBy: 'test',
      createdAt: '2024-01-01T00:00:00Z',
      sizeBytes: 10,
      metadata: {},
    }));

    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'requirements_analyst',
      name: 'Requirements Analyst',
      description: 'Analyze input sources and produce the canonical specification',
      ownedArtifacts: ['canonical_specification', 'clarification_questions'],
      readableArtifacts: ['intake_requirements', 'clarification_answers', 'diff'],
      forbiddenArtifacts: ['plan', 'implementation', 'test_plan'],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: ['reasoning', 'structured_output'],
      dispatchType: 'agent',
    });

    const assembler = new RunnerContextAssembler(store, registry, makePromptEngine());

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'REFINEMENT',
      role: 'requirements_analyst',
      inputArtifacts: [],
    });

    const types = context.inputArtifacts.map((a) => a.ref.type);
    expect(types).toContain('intake_requirements');
    expect(types).toContain('canonical_specification');
    expect(
      context.inputArtifacts.find((a) => a.ref.type === 'canonical_specification')?.ref.version,
    ).toBe(1);
  });

  it('populates outputSchema from rendered output contract when schema is non-empty', async () => {
    const schema = {
      type: 'object',
      required: ['approved', 'version'],
      properties: { approved: { type: 'boolean' }, version: { type: 'number' } },
    };
    const engine = makePromptEngine();
    (engine.render as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'Rendered prompt',
      templateRef: { role: 'architect', version: '1.0', source: 'built-in' },
      tokenEstimate: 50,
      truncations: [],
      outputContract: {
        role: 'architect',
        artifactType: 'static_review',
        schema,
        format: 'markdown_with_frontmatter',
        required: true,
        repairEnabled: true,
        maxRepairAttempts: 2,
      },
      metadata: {
        templateVersion: '1.0',
        resolvedFrom: 'architect.md',
        renderedAt: '2024-01-01T00:00:00Z',
        inputArtifactRefs: [],
        variablesUsed: [],
        partialsIncluded: [],
      },
    });

    const assembler = new RunnerContextAssembler(makeArtifactStore(), makeRoleRegistry(), engine);

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'CODE_REVIEW',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(context.constraints.outputSchema).toEqual(schema);
    expect(context.constraints.outputSchema).toHaveProperty('required');
    expect(context.constraints.outputFormat).toBe('markdown_with_frontmatter');
  });

  it('populates outputFormat from rendered output contract', async () => {
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
    );

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(context.constraints.outputFormat).toBe('json');
  });

  it('uses synthetic fallback model assignment for agent-dispatched roles when no provider exists', async () => {
    const registry = makeRoleRegistry();
    (registry.getRole as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'implementer',
      name: 'implementer',
      description: 'Implements code',
      ownedArtifacts: ['implementation'],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'claude-code',
    });
    (registry.getModelAssignment as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No model assignment');
    });
    (registry.getRecommendedModel as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No model assignment');
    });

    const assembler = new RunnerContextAssembler(makeArtifactStore(), registry, makePromptEngine());

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'implementer',
      inputArtifacts: [],
    });

    expect(context.modelAssignment.model).toBe('claude-code');
    expect(context.constraints.timeout).toBe(600_000);
  });

  it('falls back to synthetic model assignment when no model assignment exists', async () => {
    const registry = makeRoleRegistry();
    (registry.getModelAssignment as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No model assignment');
    });
    (registry.getRecommendedModel as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('No model assignment');
    });

    const assembler = new RunnerContextAssembler(makeArtifactStore(), registry, makePromptEngine());

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(context.modelAssignment.model).toBe('agent');
  });

  it('omits outputSchema when rendered output contract has empty schema', async () => {
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      makePromptEngine(),
    );

    const context = await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'state-1',
      role: 'architect',
      inputArtifacts: [],
    });

    expect(context.constraints.outputSchema).toBeUndefined();
    expect(context.constraints.outputFormat).toBe('json');
  });

  it('passes iterationCount from dispatch request to system context', async () => {
    const promptEngine = makePromptEngine();
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      promptEngine,
    );

    await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'architect',
      inputArtifacts: [],
      iterationCount: 3,
    });

    const renderCall = (promptEngine.render as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      systemContext: { iterationCount: number };
    };
    expect(renderCall.systemContext.iterationCount).toBe(3);
  });

  it('defaults iterationCount to 1 when not provided', async () => {
    const promptEngine = makePromptEngine();
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      promptEngine,
    );

    await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'architect',
      inputArtifacts: [],
    });

    const renderCall = (promptEngine.render as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      systemContext: { iterationCount: number };
    };
    expect(renderCall.systemContext.iterationCount).toBe(1);
  });

  it('passes previousReviewContent to system context', async () => {
    const promptEngine = makePromptEngine();
    const assembler = new RunnerContextAssembler(
      makeArtifactStore(),
      makeRoleRegistry(),
      promptEngine,
    );

    await assembler.assemble({
      runId: createRunId('run-1'),
      stateId: 'IMPLEMENTATION',
      role: 'architect',
      inputArtifacts: [],
      previousReviewContent: 'Missing error handling in file X',
    });

    const renderCall = (promptEngine.render as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      systemContext: { previousReviewContent: string };
    };
    expect(renderCall.systemContext.previousReviewContent).toBe('Missing error handling in file X');
  });

  describe('dependency-aware artifact selection', () => {
    function makeDependencyGraph(deps: Record<string, readonly string[]> = {}): DependencyGraph {
      return {
        getDependencies: vi.fn((type: string) => deps[type] ?? []),
        getDependents: vi.fn(() => []),
        getTransitiveDependencies: vi.fn((type: string) => {
          if (type in deps) {
            return deps[type];
          }
          throw new Error('ArtifactTypeNotInGraphError');
        }),
        getTransitiveDependents: vi.fn(() => []),
        validate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
        topologicalOrder: vi.fn(() => []),
        getProducingState: vi.fn(() => undefined),
      } satisfies DependencyGraph;
    }

    it('selects only transitive dependencies intersected with role permissions', () => {
      const graph = makeDependencyGraph({
        static_review: ['implementation', 'plan', 'canonical_specification'],
      });

      const role = {
        id: 'static_reviewer',
        name: 'Static Reviewer',
        description: 'Reviews code',
        ownedArtifacts: ['static_review'],
        readableArtifacts: [
          'implementation',
          'plan',
          'canonical_specification',
          'test_plan',
          'codebase_context',
        ],
        forbiddenArtifacts: [],
        reviewedBy: [],
        reviews: [],
        agreementParticipation: [],
        requiredCapabilities: [],
        dispatchType: 'agent' as const,
      };

      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
        graph,
      );
      const result = assembler.resolveRelevantArtifacts(role);

      expect(result).toContain('implementation');
      expect(result).toContain('plan');
      expect(result).toContain('canonical_specification');
      expect(result).not.toContain('test_plan');
      expect(result).not.toContain('codebase_context');
    });

    it('falls back to full readable set when graph has no entry for output type', () => {
      const graph = makeDependencyGraph({});

      const role = {
        id: 'custom_role',
        name: 'Custom Role',
        description: 'Custom',
        ownedArtifacts: ['custom_output'],
        readableArtifacts: ['implementation', 'plan'],
        forbiddenArtifacts: [],
        reviewedBy: [],
        reviews: [],
        agreementParticipation: [],
        requiredCapabilities: [],
        dispatchType: 'agent' as const,
      };

      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
        graph,
      );
      const result = assembler.resolveRelevantArtifacts(role);

      expect(result).toContain('implementation');
      expect(result).toContain('plan');
      expect(result).toContain('custom_output');
    });

    it('unions dependencies when role produces multiple output types', () => {
      const graph = makeDependencyGraph({
        static_review: ['implementation'],
        security_review: ['implementation', 'plan'],
      });

      const role = {
        id: 'multi_reviewer',
        name: 'Multi Reviewer',
        description: 'Reviews multiple aspects',
        ownedArtifacts: ['static_review', 'security_review'],
        readableArtifacts: ['implementation', 'plan', 'canonical_specification'],
        forbiddenArtifacts: [],
        reviewedBy: [],
        reviews: [],
        agreementParticipation: [],
        requiredCapabilities: [],
        dispatchType: 'agent' as const,
      };

      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
        graph,
      );
      const result = assembler.resolveRelevantArtifacts(role);

      expect(result).toContain('implementation');
      expect(result).toContain('plan');
      expect(result).not.toContain('canonical_specification');
    });

    it('bypasses graph walk when DispatchRequest has explicit inputArtifacts', async () => {
      const graph = makeDependencyGraph({
        static_review: ['implementation'],
      });
      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
        graph,
      );

      await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [{ type: 'plan', name: 'plan-1', version: 1, checksum: 'abc' }],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(graph.getTransitiveDependencies).not.toHaveBeenCalled();
    });

    it('returns full readable set when no dependency graph is provided', () => {
      const role = {
        id: 'architect',
        name: 'Architect',
        description: 'Reviews architecture',
        ownedArtifacts: ['static_review'],
        readableArtifacts: ['implementation', 'plan'],
        forbiddenArtifacts: [],
        reviewedBy: [],
        reviews: [],
        agreementParticipation: [],
        requiredCapabilities: [],
        dispatchType: 'agent' as const,
      };

      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
      );
      const result = assembler.resolveRelevantArtifacts(role);

      expect(result).toContain('implementation');
      expect(result).toContain('plan');
      expect(result).toContain('static_review');
    });
  });

  describe('code intelligence enrichment', () => {
    function makeCodeIntelligence(overrides: Partial<CodeIntelligence> = {}): CodeIntelligence {
      return {
        indexProject: vi.fn(),
        symbolsInDiff: vi.fn().mockReturnValue({
          symbols: [],
          relatedDefinitions: [],
          tokenEstimate: 0,
        }),
        symbolsFromRawDiff: vi.fn().mockReturnValue({
          symbols: [{ symbol: 'foo', filePath: 'src/foo.ts', line: 1, role: 'definition' }],
          relatedDefinitions: [],
          tokenEstimate: 100,
        }),
        isIndexed: vi.fn().mockReturnValue(true),
        ...overrides,
      };
    }

    function makePrDiffStore(): ArtifactStore {
      const diffContent = JSON.stringify({
        version: 1,
        baseRef: 'main',
        headRef: 'feat/test',
        diff: 'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n',
        changedFiles: [{ path: 'src/foo.ts', status: 'modified', additions: 1, deletions: 0 }],
        createdAt: '2024-01-01T00:00:00Z',
      });
      return {
        store: vi.fn(),
        get: vi.fn().mockResolvedValue({
          ref: { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
          type: 'pr_diff_context',
          name: 'compute-pr-diff',
          version: 1,
          checksum: 'diff-1',
          content: diffContent,
          producedBy: 'compute-pr-diff',
          createdAt: '2024-01-01T00:00:00Z',
          sizeBytes: diffContent.length,
          metadata: {},
        } satisfies Artifact),
        getLatest: vi.fn(),
        list: vi.fn(),
        history: vi.fn(),
        verify: vi.fn(),
        inventory: vi.fn(),
      };
    }

    function makeReviewerRegistry(): RoleRegistry {
      return {
        getRole: vi.fn().mockReturnValue({
          id: 'static_reviewer',
          name: 'Static Reviewer',
          description: 'Reviews code',
          ownedArtifacts: ['static_review'],
          readableArtifacts: ['pr_diff_context', 'implementation'],
          forbiddenArtifacts: [],
          reviewedBy: [],
          reviews: [],
          agreementParticipation: [],
          requiredCapabilities: [],
          dispatchType: 'agent',
        }),
        listRoles: vi.fn().mockReturnValue([]),
        getModelAssignment: vi.fn().mockReturnValue({
          roleId: 'static_reviewer',
          model: 'claude-3',
          maxTokens: 4096,
        }),
        validate: vi.fn(),
      };
    }

    it('enriches pr_diff_context artifacts with code intelligence data', async () => {
      const ci = makeCodeIntelligence();
      const assembler = new RunnerContextAssembler(
        makePrDiffStore(),
        makeReviewerRegistry(),
        makePromptEngine(),
        undefined,
        ci,
        '/my/repo',
      );

      const context = await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'REVIEW_EXECUTION',
        role: 'static_reviewer',
        inputArtifacts: [
          { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ci.indexProject).toHaveBeenCalledWith('/my/repo');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ci.symbolsFromRawDiff).toHaveBeenCalled();
      const enrichedContent = JSON.parse(context.inputArtifacts[0].content) as {
        codeIntelligence?: { symbols: unknown[] };
      };
      expect(enrichedContent.codeIntelligence).toBeDefined();
      expect(enrichedContent.codeIntelligence?.symbols).toHaveLength(1);
    });

    it('skips enrichment when code intelligence returns empty results', async () => {
      const ci = makeCodeIntelligence({
        symbolsFromRawDiff: vi.fn().mockReturnValue({
          symbols: [],
          relatedDefinitions: [],
          tokenEstimate: 0,
        }),
      });
      const store = makePrDiffStore();
      const assembler = new RunnerContextAssembler(
        store,
        makeReviewerRegistry(),
        makePromptEngine(),
        undefined,
        ci,
        '/my/repo',
      );

      const context = await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'REVIEW_EXECUTION',
        role: 'static_reviewer',
        inputArtifacts: [
          { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
        ],
      });

      const content = JSON.parse(context.inputArtifacts[0].content) as {
        codeIntelligence?: unknown;
      };
      expect(content.codeIntelligence).toBeUndefined();
    });

    it('does not enrich non-pr_diff_context artifacts', async () => {
      const ci = makeCodeIntelligence();
      const assembler = new RunnerContextAssembler(
        makeArtifactStore(),
        makeRoleRegistry(),
        makePromptEngine(),
        undefined,
        ci,
        '/my/repo',
      );

      await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'state-1',
        role: 'architect',
        inputArtifacts: [{ type: 'implementation', name: 'src-1', version: 1, checksum: 'abc' }],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ci.symbolsFromRawDiff).not.toHaveBeenCalled();
    });

    it('passes through artifacts when no code intelligence is provided', async () => {
      const assembler = new RunnerContextAssembler(
        makePrDiffStore(),
        makeReviewerRegistry(),
        makePromptEngine(),
      );

      const context = await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'REVIEW_EXECUTION',
        role: 'static_reviewer',
        inputArtifacts: [
          { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
        ],
      });

      const content = JSON.parse(context.inputArtifacts[0].content) as {
        codeIntelligence?: unknown;
      };
      expect(content.codeIntelligence).toBeUndefined();
    });

    it('skips enrichment when project is not indexed', async () => {
      const ci = makeCodeIntelligence({
        isIndexed: vi.fn().mockReturnValue(false),
      });
      const assembler = new RunnerContextAssembler(
        makePrDiffStore(),
        makeReviewerRegistry(),
        makePromptEngine(),
        undefined,
        ci,
        '/my/repo',
      );

      const context = await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'REVIEW_EXECUTION',
        role: 'static_reviewer',
        inputArtifacts: [
          { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(ci.indexProject).not.toHaveBeenCalled();
      const content = JSON.parse(context.inputArtifacts[0].content) as {
        codeIntelligence?: unknown;
      };
      expect(content.codeIntelligence).toBeUndefined();
    });

    it('gracefully skips enrichment when indexProject throws', async () => {
      const ci = makeCodeIntelligence({
        indexProject: vi.fn().mockImplementation(() => {
          throw new Error('scip-typescript not found');
        }),
      });
      const assembler = new RunnerContextAssembler(
        makePrDiffStore(),
        makeReviewerRegistry(),
        makePromptEngine(),
        undefined,
        ci,
        '/my/repo',
      );

      const context = await assembler.assemble({
        runId: createRunId('run-1'),
        stateId: 'REVIEW_EXECUTION',
        role: 'static_reviewer',
        inputArtifacts: [
          { type: 'pr_diff_context', name: 'compute-pr-diff', version: 1, checksum: 'diff-1' },
        ],
      });

      expect(context.inputArtifacts).toHaveLength(1);
      const content = JSON.parse(context.inputArtifacts[0].content) as {
        codeIntelligence?: unknown;
      };
      expect(content.codeIntelligence).toBeUndefined();
    });
  });
});
