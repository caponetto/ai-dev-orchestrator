import { describe, expect, it } from 'vitest';

import { DefaultTokenEstimator } from '../default-token-estimator';

describe('DefaultTokenEstimator', () => {
  it('estimates tokens using ~4 chars per token', () => {
    const estimator = new DefaultTokenEstimator();
    expect(estimator.estimate('abcd')).toBe(1);
    expect(estimator.estimate('abcde')).toBe(2);
    expect(estimator.estimate('12345678')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    const estimator = new DefaultTokenEstimator();
    expect(estimator.estimate('')).toBe(0);
  });

  it('accepts custom chars-per-token ratio', () => {
    const estimator = new DefaultTokenEstimator(2);
    expect(estimator.estimate('abcd')).toBe(2);
  });

  it('truncateToFit returns text unchanged when within budget', () => {
    const estimator = new DefaultTokenEstimator();
    const text = 'short text';
    expect(estimator.truncateToFit(text, 100)).toBe(text);
  });

  it('truncateToFit truncates text to fit token budget', () => {
    const estimator = new DefaultTokenEstimator();
    const text = 'a'.repeat(100);
    const result = estimator.truncateToFit(text, 10);
    expect(result.length).toBe(40);
    expect(estimator.estimate(result)).toBe(10);
  });

  it('ignores model parameter gracefully', () => {
    const estimator = new DefaultTokenEstimator();
    expect(estimator.estimate('test', 'claude-sonnet')).toBe(1);
    expect(estimator.truncateToFit('test', 100, 'claude-sonnet')).toBe('test');
  });
});
