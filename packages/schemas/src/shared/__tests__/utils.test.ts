import { describe, expect, it } from 'vitest';

import { runSummaryViewSchema } from '../../dashboard/dashboard-domain';
import { safeParseResponse, SchemaValidationError } from '../utils';

describe('safeParseResponse', () => {
  const validData = {
    runId: 'r-1',
    repository: 'test',
    workflow: 'default',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:01:00Z',
    durationMs: 60000,
    totalArtifacts: 5,
    totalTokens: 1000,
    totalInputTokens: 600,
    totalOutputTokens: 400,
    finalState: 'DONE',
  };

  it('returns parsed data when schema matches', () => {
    const result = safeParseResponse(runSummaryViewSchema, validData);
    expect(result).toEqual(validData);
  });

  it('throws SchemaValidationError when schema fails', () => {
    const badData = { runId: 123 };
    expect(() => safeParseResponse(runSummaryViewSchema, badData)).toThrow(SchemaValidationError);
  });

  it('exposes validation issues on the error', () => {
    try {
      safeParseResponse(runSummaryViewSchema, { runId: 123 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      expect((e as SchemaValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it('strips extra properties without .loose()', () => {
    const result = safeParseResponse(runSummaryViewSchema, {
      ...validData,
      extraField: 'should be stripped',
    });
    expect(result.runId).toBe('r-1');
    expect('extraField' in result).toBe(false);
  });

  it('throws SchemaValidationError when parse succeeds but data is undefined', () => {
    const schemaWithUndefinedData = {
      safeParse: () => ({ success: true, data: undefined }),
    };
    expect(() => {
      safeParseResponse(schemaWithUndefinedData, 'anything');
    }).toThrow(SchemaValidationError);
  });
});
