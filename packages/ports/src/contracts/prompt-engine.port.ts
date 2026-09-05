import type {
  OutputContract,
  OutputValidationResult,
  PromptTemplate,
  RenderRequest,
  RenderedPrompt,
  TemplateValidationResult,
} from '@ai-dev-orchestrator/schemas';

/** Port for the prompt engine that renders prompts and validates structured output. */
export interface PromptEngine {
  /** Render a prompt for a role invocation, resolving templates and assembling context. */
  render(request: RenderRequest): Promise<RenderedPrompt>;

  /** Validate worker output against a structured output contract. */
  validateOutput(output: string, contract: OutputContract): OutputValidationResult;

  /** Validate a prompt template for syntax and binding correctness. */
  validateTemplate(template: PromptTemplate): TemplateValidationResult;
}
