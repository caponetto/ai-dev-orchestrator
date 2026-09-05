import type { PromptTemplate, RenderRequest } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { MissingPartialError, RequiredVariableMissingError } from '../../domain/errors';
import { DefaultPromptEngine } from '../default-prompt-engine';
import { DefaultTemplateRegistry } from '../default-template-registry';
import { DefaultTokenEstimator } from '../default-token-estimator';

function makeTemplate(): PromptTemplate {
  return {
    frontmatter: {
      role: 'architect',
      version: '1.0',
      description: 'Architecture review',
      variables: [{ name: 'implementation', type: 'artifact', required: true }],
      outputContract: {
        role: 'architect',
        artifactType: 'static_review',
        schema: {},
        format: 'json',
        required: true,
        repairEnabled: true,
        maxRepairAttempts: 3,
      },
    },
    body: 'Review this code:\n{{implementation}}',
    source: 'architect.md',
  };
}

function makeRequest(): RenderRequest {
  return {
    role: 'architect',
    inputArtifacts: [
      {
        ref: { type: 'implementation', name: 'src-1', version: 1, checksum: 'abc123' },
        content: 'const x = 1;',
      },
    ],
    constraints: {
      maxOutputTokens: 4000,
      timeout: 30000,
      requiredOutputType: 'static_review',
    },
    systemContext: {
      runId: 'run-1',
      currentState: 'analyzing',
      iterationCount: 1,
    },
  };
}

function createEngine() {
  const registry = new DefaultTemplateRegistry();
  registry.register(makeTemplate());
  const tokenEstimator = new DefaultTokenEstimator();
  const engine = new DefaultPromptEngine(registry, tokenEstimator);
  return { engine, registry };
}

describe('DefaultPromptEngine', () => {
  it('renders a prompt with template variables', async () => {
    const { engine } = createEngine();
    const result = await engine.render(makeRequest());

    expect(result.text).toContain('Review this code:');
    expect(result.text).toContain('const x = 1;');
  });

  it('returns correct template ref', async () => {
    const { engine } = createEngine();
    const result = await engine.render(makeRequest());

    expect(result.templateRef.role).toBe('architect');
    expect(result.templateRef.version).toBe('1.0');
    expect(result.templateRef.source).toBe('built-in');
  });

  it('estimates token count', async () => {
    const { engine } = createEngine();
    const result = await engine.render(makeRequest());

    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it('populates metadata', async () => {
    const { engine } = createEngine();
    const result = await engine.render(makeRequest());

    expect(result.metadata.templateVersion).toBe('1.0');
    expect(result.metadata.resolvedFrom).toBe('architect.md');
    expect(result.metadata.renderedAt).toBeTruthy();
    expect(result.metadata.inputArtifactRefs).toHaveLength(1);
    expect(result.metadata.variablesUsed).toContain('implementation');
  });

  it('returns output contract from template', async () => {
    const { engine } = createEngine();
    const result = await engine.render(makeRequest());

    expect(result.outputContract.role).toBe('architect');
    expect(result.outputContract.format).toBe('json');
    expect(result.outputContract.repairEnabled).toBe(true);
  });

  it('validates valid JSON output', () => {
    const { engine } = createEngine();
    const contract = makeTemplate().frontmatter.outputContract;
    const result = engine.validateOutput('{"title": "test"}', contract);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JSON output', () => {
    const { engine } = createEngine();
    const contract = makeTemplate().frontmatter.outputContract;
    const result = engine.validateOutput('not json', contract);
    expect(result.valid).toBe(false);
  });

  it('validates template structure', () => {
    const { engine } = createEngine();
    const valid = engine.validateTemplate(makeTemplate());
    expect(valid.valid).toBe(true);
    expect(valid.errors).toEqual([]);
  });

  it('detects invalid template with empty body', () => {
    const { engine } = createEngine();
    const template: PromptTemplate = {
      ...makeTemplate(),
      body: '',
    };
    const result = engine.validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'body')).toBe(true);
  });

  it('applies variable overrides from request', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          { name: 'custom', type: 'literal', required: false },
        ],
      },
      body: '{{implementation}} - {{custom}}',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = {
      ...makeRequest(),
      overrides: { variableOverrides: { custom: 'custom_value' } },
    };
    const result = await engine.render(request);
    expect(result.text).toContain('custom_value');
  });

  it('throws RequiredVariableMissingError when required variable has no value', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          { name: 'missingRequired', type: 'artifact', required: true },
        ],
      },
      body: '{{implementation}} {{missingRequired}}',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = { ...makeRequest() };
    await expect(engine.render(request)).rejects.toThrow(RequiredVariableMissingError);
  });

  it('defaults optional variables to empty string when not provided', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          { name: 'optionalVar', type: 'literal', required: false },
        ],
      },
      body: '{{implementation}}[{{optionalVar}}]',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = { ...makeRequest() };
    const result = await engine.render(request);
    expect(result.text).toContain('[');
    expect(result.text).not.toContain('undefined');
  });

  it('uses explicit default value over empty string for optional variables', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          { name: 'mode', type: 'literal', required: false, default: 'standard' },
        ],
      },
      body: '{{implementation}} mode={{mode}}',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = { ...makeRequest() };
    const result = await engine.render(request);
    expect(result.text).toContain('mode=standard');
  });

  it('maps previousReviewContent to previousFindings template variable', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          { name: 'previousFindings', type: 'literal', required: false },
        ],
      },
      body: '{{implementation}} {{previousFindings}}',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = {
      ...makeRequest(),
      systemContext: {
        ...makeRequest().systemContext,
        previousReviewContent: 'Code has missing null checks',
      },
    };
    const result = await engine.render(request);
    expect(result.text).toContain('Code has missing null checks');
  });

  it('resolves partials in template body', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        partials: ['json_rules'],
      },
      body: 'Review:\n{{implementation}}\n{{>json_rules}}',
    });
    const partials = { json_rules: 'Output raw JSON only.' };
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator(), partials);

    const result = await engine.render(makeRequest());
    expect(result.text).toContain('Output raw JSON only.');
    expect(result.text).not.toContain('{{>json_rules}}');
  });

  it('throws MissingPartialError when declared partial is not loaded', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        partials: ['nonexistent_partial'],
      },
      body: 'Review:\n{{implementation}}',
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator(), {});

    await expect(engine.render(makeRequest())).rejects.toThrow(MissingPartialError);
  });

  it('passes loaded partials through even if not declared in frontmatter', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      body: 'Review:\n{{implementation}}\n{{>extra}}',
    });
    const partials = { extra: 'Extra content here.' };
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator(), partials);

    const result = await engine.render(makeRequest());
    expect(result.text).toContain('Extra content here.');
  });

  it('renders optional artifact variables with conditional blocks for partial inputs', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        variables: [
          { name: 'implementation', type: 'artifact', required: true },
          {
            name: 'static_review',
            type: 'artifact',
            required: false,
            artifactType: 'static_review',
          },
          { name: 'docs_review', type: 'artifact', required: false, artifactType: 'docs_review' },
        ],
      },
      body: [
        '{{implementation}}',
        '{{#if static_review}}',
        'Static: {{{static_review}}}',
        '{{/if}}',
        '{{#if docs_review}}',
        'Docs: {{{docs_review}}}',
        '{{/if}}',
      ].join('\n'),
    });
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator());

    const request: RenderRequest = {
      ...makeRequest(),
      inputArtifacts: [
        {
          ref: { type: 'implementation', name: 'src-1', version: 1, checksum: 'abc123' },
          content: 'const x = 1;',
        },
        {
          ref: { type: 'docs_review', name: 'docs-1', version: 1, checksum: 'def456' },
          content: '{"findings": []}',
        },
      ],
    };
    const result = await engine.render(request);

    expect(result.text).toContain('Docs: ');
    expect(result.text).toContain('"__artifactType": "docs_review"');
    expect(result.text).toContain('"findings": []');
    expect(result.text).not.toContain('Static:');
  });

  it('records partials in metadata', async () => {
    const registry = new DefaultTemplateRegistry();
    registry.register({
      ...makeTemplate(),
      frontmatter: {
        ...makeTemplate().frontmatter,
        partials: ['json_rules'],
      },
      body: 'Review:\n{{implementation}}\n{{>json_rules}}',
    });
    const partials = { json_rules: 'Output raw JSON only.' };
    const engine = new DefaultPromptEngine(registry, new DefaultTokenEstimator(), partials);

    const result = await engine.render(makeRequest());
    expect(result.metadata.partialsIncluded).toEqual(['json_rules']);
  });
});
