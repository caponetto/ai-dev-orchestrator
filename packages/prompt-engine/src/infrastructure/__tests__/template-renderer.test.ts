import { describe, expect, it } from 'vitest';

import { MissingPartialError, UndefinedVariableError } from '../../domain/errors';
import { renderTemplate } from '../template-renderer';

describe('renderTemplate', () => {
  it('interpolates simple variables with HTML escaping', () => {
    const result = renderTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('escapes HTML in double-brace interpolation', () => {
    const result = renderTemplate('{{content}}', { content: '<script>alert("xss")</script>' });
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('does not escape HTML in triple-brace interpolation', () => {
    const result = renderTemplate('{{{content}}}', { content: '<b>bold</b>' });
    expect(result).toBe('<b>bold</b>');
  });

  it('resolves nested property access', () => {
    const result = renderTemplate('{{user.name}}', { user: { name: 'Alice' } });
    expect(result).toBe('Alice');
  });

  it('resolves deeply nested properties', () => {
    const result = renderTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } });
    expect(result).toBe('deep');
  });

  it('renders #if block when condition is truthy', () => {
    const result = renderTemplate('{{#if show}}visible{{/if}}', { show: true });
    expect(result).toBe('visible');
  });

  it('hides #if block when condition is falsy', () => {
    const result = renderTemplate('{{#if show}}visible{{/if}}', { show: false });
    expect(result).toBe('');
  });

  it('renders #unless block when condition is falsy', () => {
    const result = renderTemplate('{{#unless hidden}}shown{{/unless}}', { hidden: false });
    expect(result).toBe('shown');
  });

  it('hides #unless block when condition is truthy', () => {
    const result = renderTemplate('{{#unless hidden}}shown{{/unless}}', { hidden: true });
    expect(result).toBe('');
  });

  it('renders #each block with array', () => {
    const result = renderTemplate('{{#each items}}{{name}},{{/each}}', {
      items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    expect(result).toBe('a,b,c,');
  });

  it('provides @index, @first, @last in each blocks', () => {
    const template =
      '{{#each items}}[{{@index}}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}}]{{/each}}';
    const result = renderTemplate(template, {
      items: [{ x: 1 }, { x: 2 }, { x: 3 }],
    });
    expect(result).toBe('[0F][1][2L]');
  });

  it('renders empty string for #each on empty array', () => {
    const result = renderTemplate('{{#each items}}x{{/each}}', { items: [] });
    expect(result).toBe('');
  });

  it('strips comments', () => {
    const result = renderTemplate('before{{! this is a comment }}after', {});
    expect(result).toBe('beforeafter');
  });

  it('resolves partials', () => {
    const result = renderTemplate('{{> header}}\nbody', {}, { header: '# Title' });
    expect(result).toBe('# Title\nbody');
  });

  it('resolves nested partials', () => {
    const partials = {
      outer: 'before {{> inner}} after',
      inner: 'INNER CONTENT',
    };
    const result = renderTemplate('{{> outer}}', {}, partials);
    expect(result).toBe('before INNER CONTENT after');
  });

  it('resolves deeply nested partials', () => {
    const partials = {
      level1: 'L1[{{> level2}}]',
      level2: 'L2[{{> level3}}]',
      level3: 'L3',
    };
    const result = renderTemplate('{{> level1}}', {}, partials);
    expect(result).toBe('L1[L2[L3]]');
  });

  it('throws MissingPartialError for missing partial', () => {
    expect(() => renderTemplate('{{> missing}}', {}, {}, 'test')).toThrow(MissingPartialError);
  });

  it('throws UndefinedVariableError for missing variable', () => {
    expect(() => renderTemplate('{{missing}}', {}, {}, 'test')).toThrow(UndefinedVariableError);
  });

  it('treats empty array as falsy in #if', () => {
    const result = renderTemplate('{{#if items}}has items{{/if}}', { items: [] });
    expect(result).toBe('');
  });

  it('treats null as falsy', () => {
    const result = renderTemplate('{{#if value}}yes{{/if}}', { value: null });
    expect(result).toBe('');
  });
});
