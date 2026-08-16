import { describe, expect, it } from 'vitest';

import { parseYamlAndNormalize, parseYamlSafe } from '../yaml';

describe('parseYamlSafe', () => {
  it('parses valid YAML into an object', () => {
    const result = parseYamlSafe('name: test\ncount: 42');
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('throws for invalid YAML', () => {
    expect(() => parseYamlSafe('{')).toThrow();
  });

  it('throws when YAML content is not an object', () => {
    expect(() => parseYamlSafe('42')).toThrow('YAML content must be an object');
    expect(() => parseYamlSafe('"just a string"')).toThrow('YAML content must be an object');
  });

  it('handles nested structures', () => {
    const yaml = 'parent:\n  child: value\n  list:\n    - a\n    - b';
    const result = parseYamlSafe(yaml);
    expect(result).toEqual({
      parent: { child: 'value', list: ['a', 'b'] },
    });
  });
});

describe('parseYamlAndNormalize', () => {
  it('parses YAML and converts snake_case keys to camelCase', () => {
    const result = parseYamlAndNormalize('max_review_iterations: 2\nsome_key: value');
    expect(result).toEqual({ maxReviewIterations: 2, someKey: 'value' });
  });
});
