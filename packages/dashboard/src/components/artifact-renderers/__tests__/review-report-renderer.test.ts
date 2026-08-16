import { describe, expect, it } from 'vitest';

import { renderReviewReport } from '../review-report-renderer';
import type { ReviewReportFinding, ReviewReportView } from '../shared';

describe('renderReviewReport', () => {
  describe('heading — resolveReviewStatus', () => {
    it('uses verdict when present', () => {
      const view: ReviewReportView = { verdict: 'approve' };
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report: approve');
    });

    it('uses "approve" when verdict is absent and approved is true', () => {
      const view: ReviewReportView = { approved: true };
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report: approve');
    });

    it('uses "request_changes" when verdict is absent and approved is false', () => {
      const view: ReviewReportView = { approved: false };
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report: request_changes');
    });

    it('prefers verdict over approved when both present', () => {
      const view: ReviewReportView = { verdict: 'needs_work', approved: true };
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report: needs_work');
      expect(result).not.toContain('approve');
    });

    it('renders plain heading when both verdict and approved are absent', () => {
      const view: ReviewReportView = {};
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report');
      expect(result).not.toContain('# Review Report:');
    });
  });

  describe('metadata', () => {
    it('renders metadata when id and version are present', () => {
      const view = { id: 'rr-001', version: 5 } as unknown as ReviewReportView;
      const result = renderReviewReport(view);
      expect(result).toContain('**Id:** rr-001');
      expect(result).toContain('**Version:** 5');
    });

    it('omits metadata when no metadata keys are present', () => {
      const view: ReviewReportView = { verdict: 'approve' };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**Id:**');
      expect(result).not.toContain('**Version:**');
    });
  });

  describe('summary', () => {
    it('renders summary as blockquote when present', () => {
      const view: ReviewReportView = { summary: 'Overall good code quality' };
      const result = renderReviewReport(view);
      expect(result).toContain('> Overall good code quality');
    });

    it('omits summary when absent', () => {
      const view: ReviewReportView = {};
      const result = renderReviewReport(view);
      expect(result).not.toContain('>');
    });
  });

  describe('reviewSummary', () => {
    it('renders reviewSummary key-value pairs', () => {
      const view: ReviewReportView = {
        reviewSummary: { totalFindings: 5, passRate: '95%' },
      };
      const result = renderReviewReport(view);
      expect(result).toContain('**Total Findings:** 5');
      expect(result).toContain('**Pass Rate:** 95%');
    });

    it('filters out null values from reviewSummary', () => {
      const view: ReviewReportView = {
        reviewSummary: { present: 'yes', absent: null },
      };
      const result = renderReviewReport(view);
      expect(result).toContain('**Present:** yes');
      expect(result).not.toContain('Absent');
    });

    it('JSON-stringifies object values in reviewSummary', () => {
      const view: ReviewReportView = {
        reviewSummary: { breakdown: { passed: 3, failed: 1 } },
      };
      const result = renderReviewReport(view);
      expect(result).toContain('**Breakdown:** {"passed":3,"failed":1}');
    });

    it('joins pairs with dot separator', () => {
      const view: ReviewReportView = {
        reviewSummary: { a: 1, b: 2 },
      };
      const result = renderReviewReport(view);
      expect(result).toContain(' · ');
    });

    it('omits reviewSummary section when all values are null', () => {
      const view: ReviewReportView = {
        reviewSummary: { x: null, y: null },
      };
      const result = renderReviewReport(view);
      // After filtering nulls, pairs is empty string, so no section
      const sections = result.split('\n\n');
      const hasPairs = sections.some((s) => s.includes(' · '));
      expect(hasPairs).toBe(false);
    });

    it('omits reviewSummary section when reviewSummary is absent', () => {
      const view: ReviewReportView = {};
      const result = renderReviewReport(view);
      expect(result).not.toContain(' · ');
    });

    it('renders boolean values as strings', () => {
      const view: ReviewReportView = {
        reviewSummary: { compliant: true },
      };
      const result = renderReviewReport(view);
      expect(result).toContain('**Compliant:** true');
    });
  });

  describe('findings', () => {
    it('renders finding with all fields', () => {
      const findings: ReviewReportFinding[] = [
        {
          id: 'F-001',
          category: 'security',
          severity: 'critical',
          description: 'SQL injection vulnerability',
          file: 'src/db.ts',
          line: 42,
          evidence: 'query(`SELECT * FROM ${table}`)',
          suggestion: 'Use parameterized queries',
          sources: ['OWASP', 'CWE-89'],
        },
      ];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('## Findings');
      expect(result).toContain('🔴 **F-001** · critical · security');
      expect(result).toContain('SQL injection vulnerability');
      expect(result).toContain('**File:** `src/db.ts:42`');
      expect(result).toContain('**Evidence:**');
      expect(result).toContain('```ts');
      expect(result).toContain('query(`SELECT * FROM ${table}`)');
      expect(result).toContain('**Suggestion:** Use parameterized queries');
      expect(result).toContain('_Sources:_ OWASP, CWE-89');
    });

    it('renders dashes for missing id, severity, category, description', () => {
      const findings: ReviewReportFinding[] = [{}];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('⚪ **—** · — · —');
      expect(result).toContain('\n\n—');
    });

    it('renders file without line when line is null', () => {
      const findings: ReviewReportFinding[] = [{ file: 'src/main.ts', line: null }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('**File:** `src/main.ts`');
      expect(result).not.toContain('src/main.ts:');
    });

    it('renders file without line when line is absent', () => {
      const findings: ReviewReportFinding[] = [{ file: 'src/main.ts' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('**File:** `src/main.ts`');
    });

    it('renders file with line when both present', () => {
      const findings: ReviewReportFinding[] = [{ file: 'src/main.ts', line: 10 }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('**File:** `src/main.ts:10`');
    });

    it('omits file section when file is absent', () => {
      const findings: ReviewReportFinding[] = [{ description: 'Issue' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**File:**');
    });

    it('omits file section when file is null', () => {
      const findings: ReviewReportFinding[] = [{ file: null }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**File:**');
    });
  });

  describe('evidence and extractLangFromPath', () => {
    it('extracts lang from file extension for evidence block', () => {
      const findings: ReviewReportFinding[] = [{ file: 'component.tsx', evidence: '<div />' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```tsx');
    });

    it('strips line number suffix before extracting extension', () => {
      const findings: ReviewReportFinding[] = [{ file: 'src/utils.ts:42', evidence: 'code' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```ts');
    });

    it('returns empty lang when file has no extension', () => {
      const findings: ReviewReportFinding[] = [{ file: 'Makefile', evidence: 'build:' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```\n');
    });

    it('returns empty lang when file is null', () => {
      const findings: ReviewReportFinding[] = [{ file: null, evidence: 'some code' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```\n');
    });

    it('returns empty lang when file is absent', () => {
      const findings: ReviewReportFinding[] = [{ evidence: 'some code' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```\n');
    });

    it('lowercases the extension', () => {
      const findings: ReviewReportFinding[] = [{ file: 'App.TSX', evidence: 'code' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('```tsx');
    });

    it('omits evidence section when evidence is null', () => {
      const findings: ReviewReportFinding[] = [{ evidence: null }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**Evidence:**');
    });

    it('omits evidence section when evidence is absent', () => {
      const findings: ReviewReportFinding[] = [{ description: 'Issue' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**Evidence:**');
    });
  });

  describe('severity indicators', () => {
    it('renders red circle for critical severity', () => {
      const findings: ReviewReportFinding[] = [{ severity: 'critical' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('🔴');
    });

    it('renders orange circle for major severity', () => {
      const findings: ReviewReportFinding[] = [{ severity: 'major' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('🟠');
    });

    it('renders yellow circle for minor severity', () => {
      const findings: ReviewReportFinding[] = [{ severity: 'minor' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('🟡');
    });

    it('renders white circle for unknown severity', () => {
      const findings: ReviewReportFinding[] = [{ severity: 'info' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('⚪');
    });

    it('renders white circle when severity is absent', () => {
      const findings: ReviewReportFinding[] = [{}];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('⚪');
    });
  });

  describe('suggestion and sources', () => {
    it('renders suggestion when present', () => {
      const findings: ReviewReportFinding[] = [{ suggestion: 'Refactor this' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('**Suggestion:** Refactor this');
    });

    it('omits suggestion when null', () => {
      const findings: ReviewReportFinding[] = [{ suggestion: null }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**Suggestion:**');
    });

    it('omits suggestion when absent', () => {
      const findings: ReviewReportFinding[] = [{ description: 'Issue' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('**Suggestion:**');
    });

    it('renders sources when present', () => {
      const findings: ReviewReportFinding[] = [{ sources: ['src1', 'src2'] }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('_Sources:_ src1, src2');
    });

    it('omits sources when array is empty', () => {
      const findings: ReviewReportFinding[] = [{ sources: [] }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('_Sources:_');
    });

    it('omits sources when absent', () => {
      const findings: ReviewReportFinding[] = [{ description: 'Issue' }];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).not.toContain('_Sources:_');
    });
  });

  describe('no findings', () => {
    it('renders "No findings" when findings array is empty', () => {
      const view: ReviewReportView = { findings: [] };
      const result = renderReviewReport(view);
      expect(result).toContain('## Findings');
      expect(result).toContain('_No findings_');
    });

    it('renders "No findings" when findings is absent', () => {
      const view: ReviewReportView = {};
      const result = renderReviewReport(view);
      expect(result).toContain('## Findings');
      expect(result).toContain('_No findings_');
    });
  });

  describe('multiple findings', () => {
    it('separates multiple findings with horizontal rules', () => {
      const findings: ReviewReportFinding[] = [
        { id: 'F-001', severity: 'critical', description: 'First' },
        { id: 'F-002', severity: 'minor', description: 'Second' },
      ];
      const view: ReviewReportView = { findings };
      const result = renderReviewReport(view);
      expect(result).toContain('---');
      expect(result).toContain('🔴 **F-001**');
      expect(result).toContain('🟡 **F-002**');
    });
  });

  describe('remaining fields', () => {
    it('renders extra fields not in handled set', () => {
      const view = { customField: 'custom value' } as unknown as ReviewReportView;
      const result = renderReviewReport(view);
      expect(result).toContain('Custom Field');
      expect(result).toContain('custom value');
    });

    it('excludes approved, summary, verdict, findings, reviewSummary, and metadata from remaining', () => {
      const view = {
        approved: true,
        summary: 'Good',
        verdict: 'approve',
        findings: [],
        reviewSummary: { count: 0 },
        id: 'rr-001',
        version: 1,
        extraField: 'should appear',
      } as unknown as ReviewReportView;
      const result = renderReviewReport(view);
      expect(result).toContain('Extra Field');
      expect(result).toContain('should appear');
    });

    it('omits remaining section when no unknown keys exist', () => {
      const view: ReviewReportView = { verdict: 'approve', findings: [] };
      const result = renderReviewReport(view);
      const sections = result.split('\n\n');
      const lastSection = sections[sections.length - 1];
      expect(lastSection).toContain('_No findings_');
    });
  });

  describe('full integration', () => {
    it('renders a complete review report with all sections', () => {
      const findings: ReviewReportFinding[] = [
        {
          id: 'F-001',
          category: 'security',
          severity: 'critical',
          description: 'SQL injection risk',
          file: 'src/db.ts',
          line: 42,
          evidence: 'db.query(userInput)',
          suggestion: 'Use prepared statements',
          sources: ['OWASP Top 10'],
        },
        {
          id: 'F-002',
          category: 'style',
          severity: 'minor',
          description: 'Inconsistent naming',
          file: 'src/utils.ts',
        },
      ];
      const view = {
        verdict: 'request_changes',
        id: 'rr-042',
        version: 3,
        summary: 'Several issues found during review',
        reviewSummary: { totalFindings: 2, criticalCount: 1, passRate: '50%' },
        findings,
      } as unknown as ReviewReportView;
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report: request_changes');
      expect(result).toContain('**Id:** rr-042');
      expect(result).toContain('**Version:** 3');
      expect(result).toContain('> Several issues found during review');
      expect(result).toContain('**Total Findings:** 2');
      expect(result).toContain('**Critical Count:** 1');
      expect(result).toContain('**Pass Rate:** 50%');
      expect(result).toContain('## Findings');
      expect(result).toContain('🔴 **F-001** · critical · security');
      expect(result).toContain('SQL injection risk');
      expect(result).toContain('**File:** `src/db.ts:42`');
      expect(result).toContain('```ts');
      expect(result).toContain('db.query(userInput)');
      expect(result).toContain('**Suggestion:** Use prepared statements');
      expect(result).toContain('_Sources:_ OWASP Top 10');
      expect(result).toContain('---');
      expect(result).toContain('🟡 **F-002** · minor · style');
      expect(result).toContain('Inconsistent naming');
    });

    it('renders minimal review report with empty view', () => {
      const view: ReviewReportView = {};
      const result = renderReviewReport(view);
      expect(result).toContain('# Review Report');
      expect(result).toContain('_No findings_');
    });

    it('sections are separated by double newlines', () => {
      const view: ReviewReportView = {
        verdict: 'approve',
        summary: 'Looks good',
        findings: [{ id: 'F-001', severity: 'minor', description: 'Nit' }],
      };
      const result = renderReviewReport(view);
      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });
  });
});
