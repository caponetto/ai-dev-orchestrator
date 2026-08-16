import { describe, expect, it } from 'vitest';

import { FRONTMATTER_REGEX } from '../frontmatter';

describe('FRONTMATTER_REGEX', () => {
  it('matches frontmatter blocks', () => {
    const content = '---\ntitle: Test\n---\nBody content';
    const match = FRONTMATTER_REGEX.exec(content);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('title: Test');
  });

  it('does not match content without frontmatter', () => {
    expect(FRONTMATTER_REGEX.exec('No frontmatter here')).toBeNull();
  });
});
