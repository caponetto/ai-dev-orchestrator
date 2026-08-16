import { describe, expect, it } from 'vitest';

import {
  isObject,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
} from '../type-guards';

describe('isObject', () => {
  it('returns true for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it('returns false for non-objects', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject(true)).toBe(false);
  });
});

describe('requireString', () => {
  it('returns the string value', () => {
    expect(requireString({ name: 'test' }, 'name')).toBe('test');
  });

  it('throws for non-string values', () => {
    expect(() => requireString({ name: 42 }, 'name')).toThrow('Field "name" must be a string');
    expect(() => requireString({}, 'name')).toThrow('Field "name" must be a string');
  });
});

describe('requireNumber', () => {
  it('returns the number value', () => {
    expect(requireNumber({ count: 5 }, 'count')).toBe(5);
  });

  it('throws for non-number values', () => {
    expect(() => requireNumber({ count: 'five' }, 'count')).toThrow(
      'Field "count" must be a number',
    );
  });
});

describe('requireObject', () => {
  it('returns the object value', () => {
    const obj = { nested: { a: 1 } };
    expect(requireObject(obj, 'nested')).toEqual({ a: 1 });
  });

  it('throws for non-object values', () => {
    expect(() => requireObject({ nested: 'string' }, 'nested')).toThrow(
      'Field "nested" must be an object',
    );
  });
});

describe('requireStringArray', () => {
  it('returns the string array value', () => {
    expect(requireStringArray({ tags: ['a', 'b'] }, 'tags')).toEqual(['a', 'b']);
  });

  it('throws for non-array values', () => {
    expect(() => requireStringArray({ tags: 'not-array' }, 'tags')).toThrow(
      'Field "tags" must be an array of strings',
    );
  });

  it('throws for arrays with non-string elements', () => {
    expect(() => requireStringArray({ tags: ['a', 42] }, 'tags')).toThrow(
      'Field "tags" must be an array of strings',
    );
  });
});
