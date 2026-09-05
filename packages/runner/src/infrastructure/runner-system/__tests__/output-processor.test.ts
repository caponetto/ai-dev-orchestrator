import type { ArtifactStore, PromptEngine } from '@ai-dev-orchestrator/ports';
import type { RenderedPrompt, WorkerContext } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { InvalidOutputError, OutputOwnershipError } from '../../../domain/runner-system/errors';
import { OutputProcessor } from '../output-processor';

function makePromptEngine(valid = true): PromptEngine {
  return {
    render: vi.fn(),
    validateOutput: vi.fn().mockReturnValue({
      valid,
      errors: valid
        ? []
        : [{ path: '/title', message: 'required', expected: 'string', actual: 'undefined' }],
    }),
    validateTemplate: vi.fn(),
  };
}

function makeArtifactStore(): ArtifactStore {
  return {
    store: vi.fn().mockResolvedValue({
      type: 'static_review',
      name: 'architect-output',
      version: 1,
      checksum: 'abc',
    }),
    get: vi.fn(),
    getLatest: vi.fn(),
    list: vi.fn(),
    history: vi.fn(),
    verify: vi.fn(),
    inventory: vi.fn(),
  };
}

function makeContext(): WorkerContext {
  return {
    role: {
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation'],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
    },
    prompt: 'Review this code',
    inputArtifacts: [],
    modelAssignment: {
      roleId: 'architect',
      model: 'claude-3',
    },
    constraints: {
      maxOutputTokens: 4096,
      timeout: 30000,
      requiredOutputType: 'static_review',
    },
  };
}

function makeRenderedPrompt(): RenderedPrompt {
  return {
    text: 'rendered prompt',
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
  };
}

describe('OutputProcessor', () => {
  it('stores valid output as artifact', async () => {
    const store = makeArtifactStore();
    const processor = new OutputProcessor(makePromptEngine(true), store);

    const result = await processor.process('{"title": "ok"}', makeContext(), makeRenderedPrompt());

    expect(result.outputArtifacts).toHaveLength(1);
    expect(result.repairAttempts).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(store.store).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'static_review',
        producedBy: 'architect',
      }),
    );
  });

  it('throws OutputOwnershipError when role does not own artifact type', async () => {
    const context: WorkerContext = {
      ...makeContext(),
      constraints: {
        ...makeContext().constraints,
        requiredOutputType: 'implementation',
      },
    };

    const processor = new OutputProcessor(makePromptEngine(true), makeArtifactStore());

    await expect(processor.process('output', context, makeRenderedPrompt())).rejects.toThrow(
      OutputOwnershipError,
    );
  });

  it('throws InvalidOutputError when validation fails', async () => {
    const processor = new OutputProcessor(makePromptEngine(false), makeArtifactStore());

    await expect(
      processor.process('bad output', makeContext(), makeRenderedPrompt()),
    ).rejects.toThrow(InvalidOutputError);
  });
});
