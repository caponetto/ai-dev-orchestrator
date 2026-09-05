import type { PromptTemplateRegistry } from '@ai-dev-orchestrator/ports';
import type { PromptTemplate, PromptTemplateRef } from '@ai-dev-orchestrator/schemas';

/** In-memory prompt template registry backed by built-in templates only. */
export class DefaultTemplateRegistry implements PromptTemplateRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): void {
    this.templates.set(template.frontmatter.role, template);
  }

  resolve(role: string): PromptTemplate {
    const template = this.templates.get(role);
    if (!template) {
      throw new Error(`Template not found for role: ${role}`);
    }
    return template;
  }

  list(): readonly PromptTemplateRef[] {
    return Array.from(this.templates.values()).map((template) => ({
      role: template.frontmatter.role,
      version: template.frontmatter.version,
      source: 'built-in' as const,
    }));
  }

  get(ref: PromptTemplateRef): PromptTemplate {
    const template = this.templates.get(ref.role);
    if (!template) {
      throw new Error(`Template not found for role: ${ref.role}`);
    }
    return template;
  }
}
