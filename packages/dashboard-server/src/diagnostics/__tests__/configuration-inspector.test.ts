import { describe, expect, it } from 'vitest';

import { createRequiredRule, createTypeRule, inspectConfig } from '../configuration-inspector';
import type { ConfigurationRule } from '../configuration-inspector';

const CLOCK = () => '2025-01-15T10:00:00Z';

describe('inspectConfig', () => {
  it('returns valid when all rules pass', () => {
    const config = { runtime: { logLevel: 'info' } };
    const rules: ConfigurationRule[] = [createRequiredRule('runtime.logLevel')];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it('detects missing required value', () => {
    const config = { runtime: {} };
    const rules: ConfigurationRule[] = [
      createRequiredRule('runtime.logLevel', 'Set your log level'),
    ];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].severity).toBe('error');
    expect(result.entries[0].path).toBe('runtime.logLevel');
    expect(result.entries[0].suggestion).toBe('Set your log level');
  });

  it('detects wrong type as warning', () => {
    const config = { timeout: 'not-a-number' };
    const rules: ConfigurationRule[] = [createTypeRule('timeout', 'number')];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].severity).toBe('warning');
  });

  it('handles deeply nested paths', () => {
    const config = { a: { b: { c: 42 } } };
    const rules: ConfigurationRule[] = [createRequiredRule('a.b.c')];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  it('handles missing nested path gracefully', () => {
    const config = {};
    const rules: ConfigurationRule[] = [createRequiredRule('a.b.c')];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(false);
    expect(result.entries[0].currentValue).toBeUndefined();
  });

  it('passes type check when value is undefined', () => {
    const config = {};
    const rules: ConfigurationRule[] = [createTypeRule('optional', 'string')];
    const result = inspectConfig(config, rules, CLOCK);
    expect(result.valid).toBe(true);
    expect(result.entries).toHaveLength(0);
  });
});
