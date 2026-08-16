import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadPartialsFromDirectory,
  loadTemplateFromMarkdown,
  loadTemplatesFromDirectory,
} from '../template-file-loader';

describe('template-file-loader', () => {
  it('parses frontmatter and body from markdown template', () => {
    const content = `---
role: test_role
version: 1.0.0
description: A test template
variables:
  - name: input
    type: artifact
    required: true
    artifact_type: test_artifact
output_contract:
  artifact_type: test_output
  format: markdown_with_frontmatter
  required: true
  repair_enabled: true
  max_repair_attempts: 2
---
You are {{role.name}}.

## Task
Do the thing with {{input}}.
`;
    const template = loadTemplateFromMarkdown(content);
    expect(template.frontmatter.role).toBe('test_role');
    expect(template.frontmatter.version).toBe('1.0.0');
    expect(template.frontmatter.description).toBe('A test template');
    expect(template.frontmatter.variables).toHaveLength(1);
    expect(template.frontmatter.variables[0]).toEqual({
      name: 'input',
      type: 'artifact',
      required: true,
      artifactType: 'test_artifact',
    });
    expect(template.frontmatter.outputContract.artifactType).toBe('test_output');
    expect(template.frontmatter.outputContract.role).toBe('test_role');
    expect(template.frontmatter.outputContract.schema).toEqual({});
    expect(template.frontmatter.outputContract.repairEnabled).toBe(true);
    expect(template.frontmatter.outputContract.maxRepairAttempts).toBe(2);
    expect(template.body).toContain('You are {{role.name}}');
    expect(template.body).toContain('{{input}}');
    expect(template.source).toBe('file:test_role.md');
  });

  it('resolves schema from ARTIFACT_SCHEMA_MAP for known artifact types', () => {
    const content = `---
role: requirements_analyst
version: 1.0.0
description: Analyst template
variables: []
output_contract:
  artifact_type: canonical_specification
  format: markdown_with_frontmatter
  required: true
  repair_enabled: true
  max_repair_attempts: 2
---
Body.
`;
    const template = loadTemplateFromMarkdown(content);
    const schema = template.frontmatter.outputContract.schema as {
      type?: string;
      required?: readonly string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['id', 'version', 'title']));
  });

  it('loads all markdown templates from a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'template-loader-test-'));
    writeFileSync(
      join(dir, 'role_a.md'),
      `---
role: role_a
version: 1.0.0
description: Role A
variables: []
output_contract:
  artifact_type: plan
  format: markdown_with_frontmatter
  required: true
  repair_enabled: false
  max_repair_attempts: 0
---
Role A body.
`,
      'utf-8',
    );
    writeFileSync(
      join(dir, 'role_b.md'),
      `---
role: role_b
version: 1.0.0
description: Role B
variables: []
output_contract:
  artifact_type: plan
  format: markdown_with_frontmatter
  required: true
  repair_enabled: false
  max_repair_attempts: 0
---
Role B body.
`,
      'utf-8',
    );
    writeFileSync(join(dir, 'readme.txt'), 'ignore me', 'utf-8');

    const templates = loadTemplatesFromDirectory(dir);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.frontmatter.role).sort()).toEqual(['role_a', 'role_b']);
  });

  it('parses partials array from frontmatter', () => {
    const content = `---
role: reviewer
version: 1.0.0
description: A reviewer
variables: []
partials:
  - json_write_rules
  - diff_retrieval_strategy
output_contract:
  artifact_type: review_findings
  format: json
  required: true
  repair_enabled: true
  max_repair_attempts: 2
---
Body with {{>json_write_rules}}.
`;
    const template = loadTemplateFromMarkdown(content);
    expect(template.frontmatter.partials).toEqual(['json_write_rules', 'diff_retrieval_strategy']);
  });

  it('returns undefined partials when not declared in frontmatter', () => {
    const content = `---
role: planner
version: 1.0.0
description: A planner
variables: []
output_contract:
  artifact_type: plan
  format: markdown_with_frontmatter
  required: true
  repair_enabled: false
  max_repair_attempts: 0
---
Body.
`;
    const template = loadTemplateFromMarkdown(content);
    expect(template.frontmatter.partials).toBeUndefined();
  });

  it('throws when frontmatter is missing', () => {
    expect(() => loadTemplateFromMarkdown('No frontmatter here')).toThrow();
  });

  it('throws when required frontmatter fields are missing', () => {
    const content = `---
role: incomplete
---
Body here.
`;
    expect(() => loadTemplateFromMarkdown(content)).toThrow();
  });
});

describe('loadPartialsFromDirectory', () => {
  it('loads markdown files as name-content pairs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partials-loader-test-'));
    writeFileSync(join(dir, 'json-write-rules.md'), 'Output raw JSON only.\n', 'utf-8');
    writeFileSync(join(dir, 'diff-strategy.md'), 'Try local refs first.\n', 'utf-8');

    const partials = loadPartialsFromDirectory(dir);

    expect(Object.keys(partials).sort()).toEqual(['diff-strategy', 'json-write-rules']);
    expect(partials['json-write-rules']).toBe('Output raw JSON only.');
    expect(partials['diff-strategy']).toBe('Try local refs first.');
  });

  it('ignores non-markdown files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partials-loader-test-'));
    writeFileSync(join(dir, 'partial-a.md'), 'Content A', 'utf-8');
    writeFileSync(join(dir, 'readme.txt'), 'Ignore me', 'utf-8');
    writeFileSync(join(dir, 'data.json'), '{}', 'utf-8');

    const partials = loadPartialsFromDirectory(dir);

    expect(Object.keys(partials)).toEqual(['partial-a']);
  });

  it('returns empty object for empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partials-loader-test-'));

    const partials = loadPartialsFromDirectory(dir);

    expect(partials).toEqual({});
  });

  it('trims trailing whitespace from partial content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partials-loader-test-'));
    writeFileSync(join(dir, 'with-trailing.md'), 'Content\n\n\n', 'utf-8');

    const partials = loadPartialsFromDirectory(dir);

    expect(partials['with-trailing']).toBe('Content');
  });
});
