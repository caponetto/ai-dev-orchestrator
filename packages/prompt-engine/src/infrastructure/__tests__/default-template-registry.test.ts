import type { PromptTemplate } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DefaultTemplateRegistry } from '../default-template-registry';

function makeTemplate(role: string): PromptTemplate {
  return {
    frontmatter: {
      role,
      version: '1.0',
      description: `${role} template`,
      variables: [],
      outputContract: {
        role,
        artifactType: 'static_review',
        schema: {},
        format: 'freeform',
        required: false,
        repairEnabled: false,
        maxRepairAttempts: 0,
      },
    },
    body: `${role} body`,
    source: `${role}.md`,
  };
}

describe('DefaultTemplateRegistry', () => {
  it('registers and resolves a template', () => {
    const registry = new DefaultTemplateRegistry();
    registry.register(makeTemplate('architect'));

    const result = registry.resolve('architect');
    expect(result.frontmatter.role).toBe('architect');
  });

  it('throws when resolving unknown role', () => {
    const registry = new DefaultTemplateRegistry();
    expect(() => registry.resolve('unknown')).toThrow('Template not found');
  });

  it('lists all registered templates', () => {
    const registry = new DefaultTemplateRegistry();
    registry.register(makeTemplate('architect'));
    registry.register(makeTemplate('reviewer'));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.role)).toContain('architect');
    expect(list.map((t) => t.role)).toContain('reviewer');
    for (const t of list) {
      expect(t.source).toBe('built-in');
    }
  });

  it('gets template by ref', () => {
    const registry = new DefaultTemplateRegistry();
    registry.register(makeTemplate('architect'));

    const result = registry.get({ role: 'architect', version: '1.0', source: 'built-in' });
    expect(result.frontmatter.role).toBe('architect');
  });

  it('throws when getting unknown template', () => {
    const registry = new DefaultTemplateRegistry();
    expect(() => registry.get({ role: 'unknown', version: '1.0', source: 'built-in' })).toThrow(
      'Template not found',
    );
  });
});
