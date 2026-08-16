import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveEnvVars } from '../env-var-resolver';

describe('resolveEnvVars', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['TEST_API_KEY'] = 'sk-test-123';
    process.env['TEST_URL'] = 'https://api.example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('resolves set environment variables', () => {
    const config = { apiKey: '${TEST_API_KEY}' };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(0);
    expect(resolved['apiKey']).toBe('sk-test-123');
  });

  it('reports error for unresolved variables', () => {
    const config = { secret: '${MISSING_VAR}' };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.variableName).toBe('MISSING_VAR');
    expect(resolved['secret']).toBe('${MISSING_VAR}');
  });

  it('resolves nested object values', () => {
    const config = { runtime: { external: { secret: '${TEST_API_KEY}' } } };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(0);
    const runtime = resolved['runtime'] as Record<string, unknown>;
    const external = runtime['external'] as Record<string, unknown>;
    expect(external['secret']).toBe('sk-test-123');
  });

  it('resolves values in arrays', () => {
    const config = { urls: ['${TEST_URL}', 'static'] };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(0);
    expect(resolved['urls']).toEqual(['https://api.example.com', 'static']);
  });

  it('passes through non-string values unchanged', () => {
    const config = { count: 5, enabled: true, nothing: null };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(0);
    expect(resolved['count']).toBe(5);
    expect(resolved['enabled']).toBe(true);
    expect(resolved['nothing']).toBeNull();
  });

  it('resolves multiple variables in one string', () => {
    const config = { url: '${TEST_URL}/key/${TEST_API_KEY}' };
    const { resolved, errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(0);
    expect(resolved['url']).toBe('https://api.example.com/key/sk-test-123');
  });

  it('collects all errors across nested config', () => {
    const config = {
      a: '${MISSING_A}',
      nested: { b: '${MISSING_B}' },
    };
    const { errors } = resolveEnvVars(config, 'test.yaml');
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.variableName)).toEqual(['MISSING_A', 'MISSING_B']);
  });
});
