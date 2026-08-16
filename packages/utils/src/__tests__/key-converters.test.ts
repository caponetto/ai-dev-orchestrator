import { describe, expect, it } from 'vitest';

import { camelToSnake, camelToSnakeDeep, snakeToCamelDeep } from '../key-converters';

describe('snakeToCamelDeep', () => {
  it('converts snake_case keys to camelCase', () => {
    const input = { max_review_iterations: 2 };
    expect(snakeToCamelDeep(input)).toEqual({ maxReviewIterations: 2 });
  });

  it('converts nested objects', () => {
    const input = { iteration_limits: { max_review_iterations: 2 } };
    expect(snakeToCamelDeep(input)).toEqual({
      iterationLimits: { maxReviewIterations: 2 },
    });
  });

  it('handles arrays of objects', () => {
    const input = [{ field_name: 'a' }, { field_name: 'b' }];
    expect(snakeToCamelDeep(input)).toEqual([{ fieldName: 'a' }, { fieldName: 'b' }]);
  });

  it('preserves already camelCase keys', () => {
    const input = { alreadyCamel: true };
    expect(snakeToCamelDeep(input)).toEqual({ alreadyCamel: true });
  });

  it('passes through scalar values', () => {
    expect(snakeToCamelDeep('hello')).toBe('hello');
    expect(snakeToCamelDeep(42)).toBe(42);
    expect(snakeToCamelDeep(null)).toBeNull();
    expect(snakeToCamelDeep(true)).toBe(true);
  });

  it('handles multiple underscores', () => {
    const input = { max_high_severity_findings: 0 };
    expect(snakeToCamelDeep(input)).toEqual({ maxHighSeverityFindings: 0 });
  });
});

describe('camelToSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(camelToSnake('maxReviewIterations')).toBe('max_review_iterations');
  });

  it('returns already-snake_case strings unchanged', () => {
    expect(camelToSnake('already_snake')).toBe('already_snake');
  });

  it('returns ALL_CAPS strings unchanged', () => {
    expect(camelToSnake('CONSTANT')).toBe('CONSTANT');
  });

  it('handles single-word lowercase strings', () => {
    expect(camelToSnake('name')).toBe('name');
  });
});

describe('camelToSnakeDeep', () => {
  it('converts camelCase keys to snake_case', () => {
    const input = { maxReviewIterations: 2 };
    expect(camelToSnakeDeep(input)).toEqual({ max_review_iterations: 2 });
  });

  it('converts nested objects', () => {
    const input = { iterationLimits: { maxReviewIterations: 2 } };
    expect(camelToSnakeDeep(input)).toEqual({
      iteration_limits: { max_review_iterations: 2 },
    });
  });

  it('handles arrays of objects', () => {
    const input = [{ fieldName: 'a' }, { fieldName: 'b' }];
    expect(camelToSnakeDeep(input)).toEqual([{ field_name: 'a' }, { field_name: 'b' }]);
  });

  it('passes through scalar values', () => {
    expect(camelToSnakeDeep('hello')).toBe('hello');
    expect(camelToSnakeDeep(42)).toBe(42);
    expect(camelToSnakeDeep(null)).toBeNull();
    expect(camelToSnakeDeep(true)).toBe(true);
  });
});
