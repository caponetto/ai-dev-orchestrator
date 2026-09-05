import { describe, expect, it } from 'vitest';

import { transform } from '../review-findings-writer';

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    approved: true,
    summary: 'All checks passed.',
    findings: [],
    verdict: 'approve' as const,
    reviewSummary: { totalFindings: 0, critical: 0, major: 0, minor: 0 },
    createdAt: '2026-07-24T10:00:00Z',
    ...overrides,
  };
}

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    category: 'correctness' as const,
    severity: 'major' as const,
    description: 'Missing null check.',
    sources: ['static_reviewer'],
    file: 'src/handler.ts',
    line: 42,
    suggestion: 'Add a null check before access.',
    evidence: 'const x = obj.value;',
    ...overrides,
  };
}

describe('review-findings-writer transform', () => {
  it('produces version 1 and createdAt', () => {
    const result = transform(makeReport());
    expect(result.version).toBe(1);
    expect(result.createdAt).toBeTruthy();
    expect(() => new Date(result.createdAt)).not.toThrow();
  });

  it('copies summary from report', () => {
    const report = makeReport({
      summary: 'Critical issues found.',
      findings: [makeFinding({ severity: 'critical', category: 'correctness' })],
    });
    const result = transform(report);
    expect(result.summary).toBe('Critical issues found.');
  });

  it('does not include verdict in output', () => {
    const report = makeReport({ verdict: 'request_changes' });
    const result = transform(report);
    expect((result as unknown as Record<string, unknown>)['verdict']).toBeUndefined();
  });

  it('does not include reviewSummary in output', () => {
    const report = makeReport({
      findings: [
        makeFinding({ id: 'f1', severity: 'critical', file: 'src/a.ts', evidence: 'code a' }),
        makeFinding({ id: 'f2', severity: 'major', file: 'src/b.ts', evidence: 'code b' }),
      ],
    });
    const result = transform(report);
    expect((result as unknown as Record<string, unknown>)['reviewSummary']).toBeUndefined();
  });

  it('extracts title from canonical specification', () => {
    const result = transform(makeReport(), { title: 'Add rate limiting' });
    expect(result.title).toBe('Add rate limiting');
  });

  it('strips "Context:" prefix from title', () => {
    const result = transform(makeReport(), { title: 'Context: Add rate limiting' });
    expect(result.title).toBe('Add rate limiting');
  });

  it('omits title when no spec provided', () => {
    const result = transform(makeReport());
    expect(result.title).toBeUndefined();
  });

  it('omits title when spec has no title', () => {
    const result = transform(makeReport(), {});
    expect(result.title).toBeUndefined();
  });

  describe('acceptance criteria', () => {
    it('extracts addressed and notAddressed from spec correlation', () => {
      const spec = {
        correlation: {
          addressed: [{ criterion: 'AC-1', evidence: 'Implemented in handler.ts' }],
          notAddressed: [{ criterion: 'AC-2', note: 'Not in this PR' }],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toEqual({
        addressed: [{ criterion: 'AC-1', evidence: 'Implemented in handler.ts' }],
        notAddressed: [{ criterion: 'AC-2', note: 'Not in this PR' }],
      });
    });

    it('extracts partiallyAddressed from spec correlation', () => {
      const spec = {
        correlation: {
          partiallyAddressed: [{ criterion: 'AC-3', note: 'Only half done' }],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toEqual({
        partiallyAddressed: [{ criterion: 'AC-3', note: 'Only half done' }],
      });
    });

    it('includes all three criteria categories when present', () => {
      const spec = {
        correlation: {
          addressed: [{ criterion: 'AC-1' }],
          partiallyAddressed: [{ criterion: 'AC-2', note: 'WIP' }],
          notAddressed: [{ criterion: 'AC-3', note: 'Deferred' }],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toEqual({
        addressed: [{ criterion: 'AC-1' }],
        partiallyAddressed: [{ criterion: 'AC-2', note: 'WIP' }],
        notAddressed: [{ criterion: 'AC-3', note: 'Deferred' }],
      });
    });

    it('omits partiallyAddressed when it is an empty array', () => {
      const spec = {
        correlation: {
          addressed: [{ criterion: 'AC-1' }],
          partiallyAddressed: [],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toEqual({
        addressed: [{ criterion: 'AC-1' }],
      });
      expect(result.acceptanceCriteria?.partiallyAddressed).toBeUndefined();
    });

    it('omits acceptanceCriteria when no correlation', () => {
      const result = transform(makeReport(), {});
      expect(result.acceptanceCriteria).toBeUndefined();
    });

    it('omits acceptanceCriteria when correlation arrays are empty', () => {
      const spec = { correlation: { addressed: [], notAddressed: [] } };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toBeUndefined();
    });

    it('includes only addressed when notAddressed is empty', () => {
      const spec = {
        correlation: {
          addressed: [{ criterion: 'AC-1' }],
          notAddressed: [],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.acceptanceCriteria).toEqual({
        addressed: [{ criterion: 'AC-1' }],
      });
    });

    it('downgrades addressed criterion when a major finding contradicts it', () => {
      const spec = {
        correlation: {
          addressed: [
            {
              criterion: 'Provide graceful fallback to polling behavior',
              evidence: 'PR title mentions polling fallback',
            },
          ],
        },
      };
      const report = makeReport({
        findings: [
          makeFinding({
            description:
              'No runtime fallback to polling when initial SSE connection fails indefinitely',
            severity: 'major',
            category: 'correctness',
          }),
        ],
      });
      const result = transform(report, spec);
      expect(result.acceptanceCriteria?.addressed).toBeUndefined();
      expect(result.acceptanceCriteria?.partiallyAddressed).toHaveLength(1);
      expect(result.acceptanceCriteria?.partiallyAddressed?.[0]?.criterion).toContain('fallback');
      expect(result.acceptanceCriteria?.partiallyAddressed?.[0]?.note).toContain(
        'Contradicted by review finding',
      );
    });

    it('keeps addressed criterion when finding is minor only', () => {
      const spec = {
        correlation: {
          addressed: [{ criterion: 'Provide graceful fallback to polling behavior' }],
        },
      };
      const report = makeReport({
        findings: [
          makeFinding({
            description: 'Polling interval could be tuned for faster fallback',
            severity: 'minor',
            category: 'performance',
          }),
        ],
      });
      const result = transform(report, spec);
      expect(result.acceptanceCriteria?.addressed).toHaveLength(1);
      expect(result.acceptanceCriteria?.partiallyAddressed).toBeUndefined();
    });
  });

  describe('untracked changes', () => {
    it('extracts untracked changes from spec correlation', () => {
      const spec = {
        correlation: {
          untrackedChanges: [{ file: 'src/config.ts', description: 'Refactored pooling' }],
        },
      };
      const result = transform(makeReport(), spec);
      expect(result.untrackedChanges).toEqual([
        { file: 'src/config.ts', description: 'Refactored pooling' },
      ]);
    });

    it('omits untrackedChanges when empty', () => {
      const spec = { correlation: { untrackedChanges: [] } };
      const result = transform(makeReport(), spec);
      expect(result.untrackedChanges).toBeUndefined();
    });
  });

  describe('risks', () => {
    it('extracts risks from spec', () => {
      const spec = { risks: ['Connection pool contention', 'No load test'] };
      const result = transform(makeReport(), spec);
      expect(result.risks).toEqual(['Connection pool contention', 'No load test']);
    });

    it('omits risks when empty', () => {
      const spec = { risks: [] };
      const result = transform(makeReport(), spec);
      expect(result.risks).toBeUndefined();
    });

    it('omits risks when not present', () => {
      const result = transform(makeReport(), {});
      expect(result.risks).toBeUndefined();
    });
  });

  describe('findings mapping', () => {
    it('includes findings with file and suggestion', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
    });

    it('includes all findings regardless of severity or file presence', () => {
      const report = makeReport({
        findings: [
          makeFinding({ id: 'f1', severity: 'minor', file: null }),
          makeFinding({ id: 'f2', severity: 'major', file: 'src/a.ts' }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(2);
    });

    it('does not include severity in output findings', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical' })],
      });
      const result = transform(report);
      expect(
        (result.findings[0] as unknown as Record<string, unknown>)['severity'],
      ).toBeUndefined();
    });

    it('infers file path from description when file is null', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            severity: 'major',
            file: null,
            description:
              'The handler in workspaces/frontend/src/app/hooks/useRedirect.ts has a race.',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings[0]?.file).toBe('workspaces/frontend/src/app/hooks/useRedirect.ts');
    });

    it('combines file and line into file:line format', () => {
      const report = makeReport({
        findings: [makeFinding({ file: 'src/api.ts', line: 34 })],
      });
      const result = transform(report);
      expect(result.findings[0]?.file).toBe('src/api.ts:34');
    });

    it('uses file alone when line is null', () => {
      const report = makeReport({
        findings: [makeFinding({ file: 'src/api.ts', line: null })],
      });
      const result = transform(report);
      expect(result.findings[0]?.file).toBe('src/api.ts');
    });

    it('omits file and marks advisory when file is null and description has no path', () => {
      const report = makeReport({
        findings: [makeFinding({ severity: 'critical', file: null, suggestion: null })],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.file).toBeUndefined();
      expect(result.findings[0]?.actionability).toBe('advisory');
      expect(result.findings[0]?.suggestion).toBeUndefined();
    });

    it('marks findings with file as actionable', () => {
      const report = makeReport({
        findings: [makeFinding({ file: 'src/handler.ts', line: null })],
      });
      const result = transform(report);
      expect(result.findings[0]?.actionability).toBe('actionable');
    });

    it('marks findings with inferred file as actionable', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            file: null,
            description: 'Bug in src/utils/parse.ts causes crash.',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings[0]?.file).toBe('src/utils/parse.ts');
      expect(result.findings[0]?.actionability).toBe('actionable');
    });

    it('includes evidence when present', () => {
      const report = makeReport({
        findings: [makeFinding({ evidence: 'const x = null;' })],
      });
      const result = transform(report);
      expect(result.findings[0]?.evidence).toBe('const x = null;');
    });

    it('omits evidence when null', () => {
      const report = makeReport({
        findings: [makeFinding({ evidence: null })],
      });
      const result = transform(report);
      expect(result.findings[0]?.evidence).toBeUndefined();
    });

    it('strips id, category, sources, and line from output', () => {
      const report = makeReport({
        findings: [makeFinding()],
      });
      const result = transform(report);
      const finding = result.findings[0] as unknown as Record<string, unknown>;
      expect(finding['id']).toBeUndefined();
      expect(finding['category']).toBeUndefined();
      expect(finding['sources']).toBeUndefined();
      expect(finding['line']).toBeUndefined();
    });
  });

  describe('findings ordering', () => {
    it('preserves input order from the report', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            severity: 'minor',
            file: 'src/a.ts',
            evidence: 'code a',
            description: 'Minor issue',
          }),
          makeFinding({
            id: 'f2',
            severity: 'critical',
            file: 'src/b.ts',
            evidence: 'code b',
            description: 'Critical issue',
          }),
          makeFinding({
            id: 'f3',
            severity: 'major',
            file: 'src/c.ts',
            evidence: 'code c',
            description: 'Major issue',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings.map((f) => f.description)).toEqual([
        'Minor issue',
        'Critical issue',
        'Major issue',
      ]);
    });
  });

  describe('empty findings array', () => {
    it('produces empty findings when report has no findings', () => {
      const result = transform(makeReport({ findings: [] }));
      expect(result.findings).toEqual([]);
    });
  });

  describe('findings deduplication', () => {
    it('merges findings with same file and overlapping evidence', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            severity: 'major',
            description: 'Idempotency gap in skip logic.',
            file: 'scripts/setup.sh',
            line: 31,
            evidence: 'if kubectl get deployment kserve >/dev/null 2>&1; then',
          }),
          makeFinding({
            id: 'f2',
            severity: 'major',
            description: 'Single deployment used as install boundary.',
            file: 'scripts/setup.sh',
            line: null,
            evidence:
              'if kubectl get deployment kserve >/dev/null 2>&1; then\n  info "Already installed"',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.description).toContain('Idempotency gap');
      expect(result.findings[0]?.description).toContain('Additionally');
      expect(result.findings[0]?.description).toContain('Single deployment');
    });

    it('keeps first finding as primary when merging', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            severity: 'minor',
            description: 'Minor concern.',
            file: 'src/handler.ts',
            line: 10,
            evidence: 'const x = obj.value;',
          }),
          makeFinding({
            id: 'f2',
            severity: 'critical',
            description: 'Critical bug.',
            file: 'src/handler.ts',
            line: 10,
            evidence: 'const x = obj.value;',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.description).toContain('Minor concern.');
      expect(result.findings[0]?.description).toContain('Additionally');
      expect(result.findings[0]?.description).toContain('Critical bug.');
    });

    it('does not merge findings with different files', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            file: 'src/a.ts',
            evidence: 'const x = 1;',
          }),
          makeFinding({
            id: 'f2',
            file: 'src/b.ts',
            evidence: 'const x = 1;',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(2);
    });

    it('does not merge findings with non-overlapping evidence', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            file: 'src/handler.ts',
            evidence: 'const x = obj.value;',
          }),
          makeFinding({
            id: 'f2',
            file: 'src/handler.ts',
            evidence: 'function validate() { return false; }',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(2);
    });

    it('does not merge findings when both have file "unknown"', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            severity: 'major',
            file: null,
            evidence: 'same evidence',
            description: 'Finding A about unknown location.',
          }),
          makeFinding({
            id: 'f2',
            severity: 'major',
            file: null,
            evidence: 'same evidence',
            description: 'Finding B about unknown location.',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(2);
    });

    it('does not merge findings when same file but one has no evidence', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            file: 'src/handler.ts',
            line: null,
            evidence: 'const x = obj.value;',
          }),
          makeFinding({
            id: 'f2',
            file: 'src/handler.ts',
            line: null,
            evidence: null,
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(2);
    });

    it('skips already-merged candidates during dedup scan', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            file: 'src/handler.ts',
            line: null,
            evidence: 'const x = obj.value;',
            description: 'First finding.',
          }),
          makeFinding({
            id: 'f2',
            file: 'src/handler.ts',
            line: null,
            evidence: 'const x = obj.value; // same',
            description: 'Second finding (overlaps with first).',
          }),
          makeFinding({
            id: 'f3',
            file: 'src/handler.ts',
            line: null,
            evidence: 'const x = obj.value; // same overlapping',
            description: 'Third finding (also overlaps).',
          }),
        ],
      });
      const result = transform(report);
      // f2 and f3 both merge into f1 because they overlap; result is 1 finding
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.description).toContain('First finding.');
      expect(result.findings[0]?.description).toContain('Second finding');
      expect(result.findings[0]?.description).toContain('Third finding');
    });

    it('normalizes file:line when comparing for dedup', () => {
      const report = makeReport({
        findings: [
          makeFinding({
            id: 'f1',
            file: 'src/handler.ts',
            line: 10,
            evidence: 'const x = obj.value;',
          }),
          makeFinding({
            id: 'f2',
            file: 'src/handler.ts',
            line: 42,
            evidence: 'const x = obj.value;',
          }),
        ],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
    });

    it('passes through single finding unchanged', () => {
      const report = makeReport({
        findings: [makeFinding()],
      });
      const result = transform(report);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.description).toBe('Missing null check.');
    });
  });

  describe('full integration', () => {
    it('produces valid output with all fields populated', () => {
      const report = makeReport({
        verdict: 'request_changes',
        summary: 'Critical SQL injection found.',
        findings: [
          makeFinding({
            id: 'f1',
            severity: 'critical',
            description: 'SQL injection via string concatenation.',
            sources: ['security_reviewer'],
            file: 'src/api/search.ts',
            line: 34,
            suggestion: 'Use parameterized queries.',
            evidence: "db.query(`SELECT * FROM users WHERE name = '${q}'`);",
          }),
          makeFinding({
            id: 'f2',
            severity: 'minor',
            description: 'Unused import.',
            sources: ['static_reviewer'],
            file: 'src/utils.ts',
            line: 1,
            suggestion: 'Remove the import.',
            evidence: null,
          }),
        ],
        reviewSummary: { totalFindings: 2, critical: 1, major: 0, minor: 1 },
      });

      const spec = {
        title: 'Context: Add search endpoint',
        correlation: {
          addressed: [{ criterion: 'Full-text search', evidence: 'Implemented in search.ts' }],
          notAddressed: [{ criterion: 'Pagination', note: 'Deferred' }],
          untrackedChanges: [{ file: 'src/config.ts', description: 'Unrelated config change' }],
        },
        risks: ['No load testing'],
      };

      const result = transform(report, spec);

      expect(result.version).toBe(1);
      expect(result.title).toBe('Add search endpoint');
      expect((result as unknown as Record<string, unknown>)['verdict']).toBeUndefined();
      expect(result.summary).toBe('Critical SQL injection found.');
      expect(result.acceptanceCriteria?.addressed).toHaveLength(1);
      expect(result.acceptanceCriteria?.notAddressed).toHaveLength(1);
      expect(result.untrackedChanges).toHaveLength(1);
      expect(result.risks).toEqual(['No load testing']);
      expect((result as unknown as Record<string, unknown>)['reviewSummary']).toBeUndefined();
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]?.file).toBe('src/api/search.ts:34');
      expect(result.findings[1]?.file).toBe('src/utils.ts:1');
    });
  });

  it('excludes pre-existing and propagated findings from output', () => {
    const report = makeReport({
      findings: [
        makeFinding({
          id: 'f1',
          attribution: 'introduced',
          description: 'New bug',
          file: 'src/a.ts',
          evidence: 'const a = null;',
        }),
        makeFinding({
          id: 'f2',
          attribution: 'pre-existing',
          description: 'Old pattern',
          file: 'src/b.ts',
          evidence: 'const b = null;',
        }),
        makeFinding({
          id: 'f3',
          attribution: 'propagated',
          description: 'Copied pattern',
          file: 'src/c.ts',
          evidence: 'const c = null;',
        }),
        makeFinding({
          id: 'f4',
          attribution: 'worsened',
          description: 'Made worse',
          file: 'src/d.ts',
          evidence: 'const d = null;',
        }),
      ],
    });
    const result = transform(report);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.description)).toEqual(['New bug', 'Made worse']);
  });
});
