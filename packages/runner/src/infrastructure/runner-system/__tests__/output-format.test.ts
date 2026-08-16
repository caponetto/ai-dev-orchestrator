import { describe, expect, it } from 'vitest';

import { extensionForOutputFormat, labelForOutputFormat } from '../output-format';

describe('extensionForOutputFormat', () => {
  it('maps formats to extensions', () => {
    expect(extensionForOutputFormat('json')).toBe('json');
    expect(extensionForOutputFormat('yaml')).toBe('yaml');
    expect(extensionForOutputFormat('markdown_with_frontmatter')).toBe('md');
    expect(extensionForOutputFormat('freeform')).toBe('txt');
    expect(extensionForOutputFormat(undefined)).toBe('json');
  });
});

describe('labelForOutputFormat', () => {
  it('maps formats to instruction labels', () => {
    expect(labelForOutputFormat('json')).toBe('JSON');
    expect(labelForOutputFormat('yaml')).toBe('YAML');
    expect(labelForOutputFormat('markdown_with_frontmatter')).toBe(
      'markdown with YAML frontmatter',
    );
    expect(labelForOutputFormat('freeform')).toBe('plain text');
    expect(labelForOutputFormat(undefined)).toBe('JSON');
  });
});
