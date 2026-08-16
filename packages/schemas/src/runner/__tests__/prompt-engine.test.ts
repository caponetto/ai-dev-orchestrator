import { describe, expect, it } from 'vitest';

import {
  artifactContextBlockSchema,
  artifactPrioritySchema,
  findingTemplateVarSchema,
  outputContractSchema,
  outputFormatBlockSchema,
  promptContextSchema,
  promptMetadataSchema,
  promptOverridesSchema,
  promptTemplateFrontmatterSchema,
  promptTemplateRefSchema,
  promptTemplateSchema,
  repairContextSchema,
  renderedPromptSchema,
  roleContextBlockSchema,
  rulesContextBlockSchema,
  systemContextSchema,
  systemInfoBlockSchema,
  systemVariablesSchema,
  taskContextBlockSchema,
  templateValidationResultSchema,
  tokenBudgetSchema,
  truncationRecordSchema,
  truncationStrategySchema,
  validationErrorSchema,
  variableDeclarationSchema,
  variableTypeSchema,
} from '../prompt-engine';

const validRef = { type: 'plan', name: 'main-plan', version: 1, checksum: 'sha256-abc' };

describe('variableTypeSchema', () => {
  it.each(['artifact', 'system', 'computed', 'literal'])('accepts "%s"', (val) => {
    expect(variableTypeSchema.safeParse(val).success).toBe(true);
  });
});

describe('variableDeclarationSchema', () => {
  it('validates a minimal variable', () => {
    const data = { name: 'input', type: 'artifact', required: true };
    expect(variableDeclarationSchema.safeParse(data).success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const data = {
      name: 'spec',
      type: 'artifact',
      required: true,
      description: 'The specification',
      default: '',
      artifactType: 'canonical_specification',
      computedFrom: 'other_var',
    };
    expect(variableDeclarationSchema.safeParse(data).success).toBe(true);
  });
});

describe('outputContractSchema', () => {
  it('validates an output contract', () => {
    const data = {
      role: 'architect',
      artifactType: 'plan',
      schema: { tasks: 'array' },
      format: 'markdown_with_frontmatter',
      required: true,
      repairEnabled: true,
      maxRepairAttempts: 3,
    };
    expect(outputContractSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptTemplateFrontmatterSchema', () => {
  it('validates frontmatter', () => {
    const data = {
      role: 'architect',
      version: '1.0.0',
      description: 'Plan template',
      variables: [{ name: 'spec', type: 'artifact', required: true }],
      outputContract: {
        role: 'architect',
        artifactType: 'plan',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
    };
    expect(promptTemplateFrontmatterSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptTemplateSchema', () => {
  it('validates a prompt template', () => {
    const data = {
      frontmatter: {
        role: 'architect',
        version: '1.0.0',
        description: 'Plan template',
        variables: [],
        outputContract: {
          role: 'architect',
          artifactType: 'plan',
          schema: {},
          format: 'json',
          required: true,
          repairEnabled: false,
          maxRepairAttempts: 0,
        },
      },
      body: 'Create a plan for {{spec}}',
      source: 'built-in',
    };
    expect(promptTemplateSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptTemplateRefSchema', () => {
  it('validates a template ref', () => {
    const data = { role: 'architect', version: '1.0.0', source: 'built-in' };
    expect(promptTemplateRefSchema.safeParse(data).success).toBe(true);
  });

  it('rejects non-built-in source', () => {
    expect(
      promptTemplateRefSchema.safeParse({ role: 'x', version: '1', source: 'custom' }).success,
    ).toBe(false);
  });
});

describe('validationErrorSchema', () => {
  it('validates a validation error', () => {
    const data = {
      path: 'tasks[0].description',
      message: 'Required',
      expected: 'string',
      actual: 'undefined',
    };
    expect(validationErrorSchema.safeParse(data).success).toBe(true);
  });
});

describe('repairContextSchema', () => {
  it('validates a repair context', () => {
    const data = {
      originalPrompt: 'Create a plan',
      invalidOutput: '{ broken json',
      validationErrors: [
        { path: 'root', message: 'Invalid JSON', expected: 'object', actual: 'string' },
      ],
      outputContract: {
        role: 'architect',
        artifactType: 'plan',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: true,
        maxRepairAttempts: 3,
      },
      attemptNumber: 1,
      maxAttempts: 3,
    };
    expect(repairContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('context block schemas', () => {
  it('validates roleContextBlockSchema', () => {
    const data = {
      name: 'architect',
      description: 'Designs',
      ownedArtifacts: ['plan'],
      readableArtifacts: ['spec'],
      forbiddenArtifacts: [],
    };
    expect(roleContextBlockSchema.safeParse(data).success).toBe(true);
  });

  it('validates artifactContextBlockSchema', () => {
    const data = { ref: validRef, content: '# Content', tokenEstimate: 500 };
    expect(artifactContextBlockSchema.safeParse(data).success).toBe(true);
  });

  it('validates taskContextBlockSchema', () => {
    const data = { requiredOutputType: 'plan', constraints: 'Max 4096 tokens' };
    expect(taskContextBlockSchema.safeParse(data).success).toBe(true);
  });

  it('validates rulesContextBlockSchema', () => {
    expect(rulesContextBlockSchema.safeParse({ rules: ['Be concise'] }).success).toBe(true);
  });

  it('validates outputFormatBlockSchema', () => {
    expect(outputFormatBlockSchema.safeParse({ format: 'json' }).success).toBe(true);
  });

  it('validates systemInfoBlockSchema', () => {
    const data = {
      runId: 'r-1',
      currentState: 'IMPL',
      iterationCount: 1,
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(systemInfoBlockSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptContextSchema', () => {
  it('validates a prompt context', () => {
    const data = {
      role: {
        name: 'architect',
        description: 'D',
        ownedArtifacts: [],
        readableArtifacts: [],
        forbiddenArtifacts: [],
      },
      artifacts: [],
      task: { requiredOutputType: 'plan', constraints: '' },
      rules: { rules: [] },
      outputFormat: { format: 'json' },
      systemInfo: {
        runId: 'r-1',
        currentState: 'IMPL',
        iterationCount: 0,
        timestamp: '2026-01-01T00:00:00Z',
      },
      totalTokenEstimate: 1000,
    };
    expect(promptContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('truncationStrategySchema', () => {
  it.each(['tail', 'summary', 'omit'])('accepts "%s"', (val) => {
    expect(truncationStrategySchema.safeParse(val).success).toBe(true);
  });
});

describe('artifactPrioritySchema', () => {
  it('validates an artifact priority', () => {
    const data = { artifactType: 'plan', priority: 1, truncationStrategy: 'tail' };
    expect(artifactPrioritySchema.safeParse(data).success).toBe(true);
  });
});

describe('tokenBudgetSchema', () => {
  it('validates a token budget', () => {
    const data = {
      maxInputTokens: 8000,
      reservedOutputTokens: 4000,
      artifactPriority: [{ artifactType: 'plan', priority: 1, truncationStrategy: 'tail' }],
    };
    expect(tokenBudgetSchema.safeParse(data).success).toBe(true);
  });
});

describe('truncationRecordSchema', () => {
  it('validates a truncation record', () => {
    const data = {
      artifactType: 'implementation',
      originalTokens: 10000,
      truncatedTokens: 5000,
      strategy: 'summary',
    };
    expect(truncationRecordSchema.safeParse(data).success).toBe(true);
  });
});

describe('findingTemplateVarSchema', () => {
  it('validates a finding template var', () => {
    const data = {
      id: 'f-1',
      severity: 'high',
      category: 'security',
      title: 'XSS',
      status: 'open',
    };
    expect(findingTemplateVarSchema.safeParse(data).success).toBe(true);
  });
});

describe('systemContextSchema', () => {
  it('validates a minimal system context', () => {
    const data = { runId: 'r-1', currentState: 'IMPL', iterationCount: 0 };
    expect(systemContextSchema.safeParse(data).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      runId: 'r-1',
      currentState: 'IMPL',
      iterationCount: 2,
      previousFindings: [
        { id: 'f-1', severity: 'high', category: 'security', title: 'XSS', status: 'open' },
      ],
      humanFeedback: 'Focus on security',
      workflowVariant: 'fast',
    };
    expect(systemContextSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptOverridesSchema', () => {
  it('validates empty overrides', () => {
    expect(promptOverridesSchema.safeParse({}).success).toBe(true);
  });

  it('validates with variable overrides', () => {
    const data = { variableOverrides: { customVar: 'value' } };
    expect(promptOverridesSchema.safeParse(data).success).toBe(true);
  });
});

describe('promptMetadataSchema', () => {
  it('validates metadata', () => {
    const data = {
      templateVersion: '1.0.0',
      resolvedFrom: 'built-in',
      renderedAt: '2026-01-01T00:00:00Z',
      inputArtifactRefs: [validRef],
      variablesUsed: ['spec', 'plan'],
      partialsIncluded: [],
    };
    expect(promptMetadataSchema.safeParse(data).success).toBe(true);
  });
});

describe('renderedPromptSchema', () => {
  it('validates a rendered prompt', () => {
    const data = {
      text: 'Create a plan...',
      templateRef: { role: 'architect', version: '1.0.0', source: 'built-in' },
      tokenEstimate: 500,
      truncations: [],
      outputContract: {
        role: 'architect',
        artifactType: 'plan',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
      metadata: {
        templateVersion: '1.0.0',
        resolvedFrom: 'built-in',
        renderedAt: '2026-01-01T00:00:00Z',
        inputArtifactRefs: [],
        variablesUsed: [],
        partialsIncluded: [],
      },
    };
    expect(renderedPromptSchema.safeParse(data).success).toBe(true);
  });
});

describe('systemVariablesSchema', () => {
  it('validates system variables', () => {
    const data = {
      role: {
        name: 'architect',
        description: 'Designs',
        ownedArtifacts: ['plan'],
        readableArtifacts: [],
        forbiddenArtifacts: [],
      },
      run: {
        id: 'r-1',
        currentState: 'IMPL',
        iterationCount: 0,
        transitionCount: 3,
        workflowVariant: 'default',
      },
      constraints: { requiredOutputType: 'plan', maxOutputTokens: 4096, timeout: 30000 },
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(systemVariablesSchema.safeParse(data).success).toBe(true);
  });
});

describe('templateValidationResultSchema', () => {
  it('validates a passing result', () => {
    expect(templateValidationResultSchema.safeParse({ valid: true, errors: [] }).success).toBe(
      true,
    );
  });
});
