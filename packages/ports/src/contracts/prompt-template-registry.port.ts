import type { PromptTemplate, PromptTemplateRef } from '@ai-dev-orchestrator/schemas';

/** Port for discovering, loading, and resolving prompt templates. */
export interface PromptTemplateRegistry {
  /** Resolve the effective template for a role. */
  resolve(role: string): PromptTemplate;

  /** List all registered template references. */
  list(): readonly PromptTemplateRef[];

  /** Get a specific template by reference. */
  get(ref: PromptTemplateRef): PromptTemplate;

  /** Register a template in the registry. */
  register(template: PromptTemplate): void;
}
