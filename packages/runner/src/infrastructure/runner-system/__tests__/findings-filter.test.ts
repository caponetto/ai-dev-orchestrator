import type { Finding } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { filterFindings } from '../findings-filter';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    severity: 'high',
    blocking: 'must_fix',
    category: 'correctness',
    title: 'Test finding',
    description: 'A test finding',
    status: 'open',
    ...overrides,
  };
}

describe('filterFindings', () => {
  it('retains only open and escalated findings', () => {
    const findings = [
      makeFinding({ id: 'f-1', status: 'open' }),
      makeFinding({ id: 'f-2', status: 'addressed' }),
      makeFinding({ id: 'f-3', status: 'accepted' }),
      makeFinding({ id: 'f-4', status: 'rejected' }),
      makeFinding({ id: 'f-5', status: 'escalated' }),
    ];

    const result = filterFindings(findings);

    expect(result.openFindings).toHaveLength(2);
    expect(result.openFindings.map((f) => f.id)).toEqual(['f-1', 'f-5']);
  });

  it('produces summary with resolved count', () => {
    const findings = [
      makeFinding({ id: 'f-1', status: 'open' }),
      makeFinding({ id: 'f-2', status: 'addressed' }),
      makeFinding({ id: 'f-3', status: 'accepted' }),
    ];

    const result = filterFindings(findings);

    expect(result.summary).toBe('2 findings resolved in previous iterations');
  });

  it('returns empty summary when no findings were resolved', () => {
    const findings = [makeFinding({ id: 'f-1', status: 'open' })];

    const result = filterFindings(findings);

    expect(result.openFindings).toHaveLength(1);
    expect(result.summary).toBe('');
  });

  it('handles empty findings array', () => {
    const result = filterFindings([]);

    expect(result.openFindings).toHaveLength(0);
    expect(result.summary).toBe('');
  });

  it('retains all findings when all are open', () => {
    const findings = [
      makeFinding({ id: 'f-1', status: 'open' }),
      makeFinding({ id: 'f-2', status: 'open' }),
    ];

    const result = filterFindings(findings);

    expect(result.openFindings).toHaveLength(2);
    expect(result.summary).toBe('');
  });
});
