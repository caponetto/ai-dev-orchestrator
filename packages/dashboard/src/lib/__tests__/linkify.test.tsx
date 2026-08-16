// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { linkify } from '../linkify';

describe('linkify', () => {
  it('returns plain text unchanged when there are no URLs', () => {
    expect(linkify('no links here')).toBe('no links here');
  });

  it('returns empty string unchanged', () => {
    expect(linkify('')).toBe('');
  });

  it('wraps a URL in an anchor tag', () => {
    const result = linkify('visit https://example.com today');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.href).toBe('https://example.com/');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener noreferrer');
    expect(anchor?.textContent).toBe('https://example.com');
  });

  it('handles multiple URLs', () => {
    const result = linkify('see https://a.com and http://b.com/path');
    const { container } = render(<span>{result}</span>);
    const anchors = container.querySelectorAll('a');
    expect(anchors).toHaveLength(2);
    expect(anchors[0].textContent).toBe('https://a.com');
    expect(anchors[1].textContent).toBe('http://b.com/path');
  });

  it('preserves text around URLs', () => {
    const result = linkify('before https://example.com after');
    const { container } = render(<span>{result}</span>);
    expect(container.textContent).toBe('before https://example.com after');
  });

  it('handles a URL at the start of the string', () => {
    const result = linkify('https://start.com is here');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor?.textContent).toBe('https://start.com');
    expect(container.textContent).toBe('https://start.com is here');
  });

  it('handles a URL at the end of the string', () => {
    const result = linkify('go to https://end.com');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor?.textContent).toBe('https://end.com');
  });

  it('handles URLs with paths, query params, and fragments', () => {
    const result = linkify('check https://example.com/path?q=1&b=2#section');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor?.textContent).toBe('https://example.com/path?q=1&b=2#section');
  });

  it('strips trailing period from URL', () => {
    const result = linkify('visit https://example.com/path.');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor?.textContent).toBe('https://example.com/path');
    expect(container.textContent).toBe('visit https://example.com/path.');
  });

  it('strips trailing comma and semicolon from URL', () => {
    const result = linkify('see https://a.com, and https://b.com;');
    const { container } = render(<span>{result}</span>);
    const anchors = container.querySelectorAll('a');
    expect(anchors[0].textContent).toBe('https://a.com');
    expect(anchors[1].textContent).toBe('https://b.com');
  });

  it('handles URLs with balanced parentheses', () => {
    const result = linkify('see https://en.wikipedia.org/wiki/Rust_(language) for details');
    const { container } = render(<span>{result}</span>);
    const anchor = container.querySelector('a');
    expect(anchor?.textContent).toBe('https://en.wikipedia.org/wiki/Rust_(language)');
  });
});
