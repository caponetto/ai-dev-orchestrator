import type {
  PromptEngine,
  PromptTemplateRegistry,
  TokenEstimator,
} from '@ai-dev-orchestrator/ports';
import type {
  OutputContract,
  OutputValidationResult,
  PartialMap,
  PromptTemplate,
  RenderRequest,
  RenderedPrompt,
  TemplateValidationResult,
  ValidationError,
} from '@ai-dev-orchestrator/schemas';

import { MissingPartialError, RequiredVariableMissingError } from '../domain/errors';

import { validateOutput } from './output-validator';
import type { RenderContext } from './template-renderer';
import { renderTemplate } from './template-renderer';

export class DefaultPromptEngine implements PromptEngine {
  private readonly registry: PromptTemplateRegistry;
  private readonly tokenEstimator: TokenEstimator;
  private readonly loadedPartials: PartialMap;

  constructor(
    registry: PromptTemplateRegistry,
    tokenEstimator: TokenEstimator,
    partials: PartialMap = {},
  ) {
    this.registry = registry;
    this.tokenEstimator = tokenEstimator;
    this.loadedPartials = partials;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async render(request: RenderRequest): Promise<RenderedPrompt> {
    const template = this.registry.resolve(request.role);

    const context = this.buildContext(request, template);
    const partials = this.resolvePartials(template);
    const text = renderTemplate(template.body, context, partials, request.role);

    const tokenEstimate = this.tokenEstimator.estimate(text);

    return {
      text,
      templateRef: {
        role: template.frontmatter.role,
        version: template.frontmatter.version,
        source: 'built-in',
      },
      tokenEstimate,
      truncations: [],
      outputContract: template.frontmatter.outputContract,
      metadata: {
        templateVersion: template.frontmatter.version,
        resolvedFrom: template.source,
        renderedAt: new Date().toISOString(),
        inputArtifactRefs: request.inputArtifacts.map((a) => a.ref),
        variablesUsed: template.frontmatter.variables.map((v) => v.name),
        partialsIncluded: template.frontmatter.partials ?? [],
      },
    };
  }

  validateOutput(output: string, contract: OutputContract): OutputValidationResult {
    return validateOutput(output, contract);
  }

  validateTemplate(template: PromptTemplate): TemplateValidationResult {
    const errors: ValidationError[] = [];

    if (!template.frontmatter.role) {
      errors.push({
        path: 'frontmatter.role',
        message: 'Role is required',
        expected: 'string',
        actual: '',
      });
    }
    if (!template.frontmatter.version) {
      errors.push({
        path: 'frontmatter.version',
        message: 'Version is required',
        expected: 'string',
        actual: '',
      });
    }
    if (!template.body.trim()) {
      errors.push({
        path: 'body',
        message: 'Template body cannot be empty',
        expected: 'non-empty string',
        actual: '',
      });
    }

    return { valid: errors.length === 0, errors };
  }

  private buildContext(request: RenderRequest, template: PromptTemplate): RenderContext {
    const context: Record<string, unknown> = {};

    for (const artifact of request.inputArtifacts) {
      context[artifact.ref.type] = this.annotateArtifactContent(
        artifact.content,
        artifact.ref.type,
      );
    }

    // Map input artifacts to template variable names (variable.name <- artifact of matching type)
    for (const variable of template.frontmatter.variables) {
      if (variable.type === 'artifact' && context[variable.name] === undefined) {
        const match = request.inputArtifacts.find((a) => a.ref.type === variable.artifactType);
        if (match) {
          context[variable.name] = this.annotateArtifactContent(match.content, match.ref.type);
        }
      }
    }

    context['role'] = {
      name: request.role,
      description: template.frontmatter.description,
    };

    context['run'] = {
      id: request.systemContext.runId,
      currentState: request.systemContext.currentState,
      iterationCount: request.systemContext.iterationCount,
    };

    context['constraints'] = {
      requiredOutputType: request.constraints.requiredOutputType,
      maxOutputTokens: request.constraints.maxOutputTokens,
      timeout: request.constraints.timeout,
    };

    if (request.systemContext.humanFeedback) {
      context['humanFeedback'] = request.systemContext.humanFeedback;
    }

    if (request.systemContext.previousReviewContent) {
      context['previousFindings'] = request.systemContext.previousReviewContent;
    }

    if (request.overrides?.variableOverrides) {
      for (const [key, value] of Object.entries(request.overrides.variableOverrides)) {
        context[key] = value;
      }
    }

    for (const variable of template.frontmatter.variables) {
      if (context[variable.name] === undefined) {
        if (variable.default !== undefined) {
          context[variable.name] = variable.default;
        } else if (variable.required) {
          throw new RequiredVariableMissingError(variable.name, request.role);
        } else {
          context[variable.name] = '';
        }
      }
    }

    return context;
  }

  private annotateArtifactContent(content: string, artifactType: string): string {
    try {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return JSON.stringify(
          { __artifactType: artifactType, ...(parsed as Record<string, unknown>) },
          null,
          2,
        );
      }
    } catch {
      // Not JSON — return as-is
    }
    return content;
  }

  private resolvePartials(template: PromptTemplate): Record<string, string> {
    const declared = template.frontmatter.partials ?? [];
    for (const name of declared) {
      if (!Object.hasOwn(this.loadedPartials, name)) {
        throw new MissingPartialError(name);
      }
    }
    return { ...this.loadedPartials };
  }
}
