import type { FindingSummary } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { QualityGateChecker } from '../quality-gate-checker';

const checker = new QualityGateChecker();

function makeFinding(overrides: Partial<FindingSummary> = {}): FindingSummary {
  return {
    id: 'f1',
    severity: 'high',
    status: 'open',
    description: 'Test finding',
    ...overrides,
  };
}

describe('QualityGateChecker', () => {
  it('passes when no findings', () => {
    const result = checker.evaluate([], 0, 3);
    expect(result.result).toBe('pass');
  });

  it('passes when findings within thresholds', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'medium' }),
      makeFinding({ id: 'f2', severity: 'medium' }),
    ];
    const result = checker.evaluate(findings, 0, 3);
    expect(result.result).toBe('pass');
  });

  it('fails when high severity findings exceed limit', () => {
    const findings = [makeFinding({ id: 'f1', severity: 'high' })];
    const result = checker.evaluate(findings, 0, 3);
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('high-severity');
  });

  it('fails when medium severity findings exceed limit', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'medium' }),
      makeFinding({ id: 'f2', severity: 'medium' }),
      makeFinding({ id: 'f3', severity: 'medium' }),
      makeFinding({ id: 'f4', severity: 'medium' }),
    ];
    const result = checker.evaluate(findings, 0, 3);
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('medium-severity');
  });

  it('ignores resolved findings', () => {
    const findings = [makeFinding({ id: 'f1', severity: 'high', status: 'addressed' })];
    const result = checker.evaluate(findings, 0, 3);
    expect(result.result).toBe('pass');
  });

  it('reports multiple failures', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'high' }),
      makeFinding({ id: 'f2', severity: 'medium' }),
      makeFinding({ id: 'f3', severity: 'medium' }),
      makeFinding({ id: 'f4', severity: 'medium' }),
      makeFinding({ id: 'f5', severity: 'medium' }),
    ];
    const result = checker.evaluate(findings, 0, 3);
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('high-severity');
    expect(result.detail).toContain('medium-severity');
  });
});
