import { describe, expect, it } from 'vitest';

import { renderReviewFindings } from '../review-findings-renderer';
import type { ACEntry, JsonObject, ReviewFinding, UntrackedChangeEntry } from '../shared';

describe('renderReviewFindings', () => {
  describe('header rendering', () => {
    it('renders title as heading', () => {
      const view: JsonObject = { title: 'Code Review', findings: [] };
      const result = renderReviewFindings(view);
      expect(result).toContain('# Code Review');
    });

    it('strips "Context: " prefix from title (case-insensitive)', () => {
      const view: JsonObject = { title: 'Context: Login Feature', findings: [] };
      const result = renderReviewFindings(view);
      expect(result).toContain('# Login Feature');
      expect(result).not.toContain('Context:');
    });

    it('strips "context: " prefix (lowercase) from title', () => {
      const view: JsonObject = { title: 'context: Refactoring', findings: [] };
      const result = renderReviewFindings(view);
      expect(result).toContain('# Refactoring');
    });

    it('omits heading when title is absent', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toMatch(/^# /m);
    });
  });

  describe('summary', () => {
    it('renders summary when present', () => {
      const view: JsonObject = { summary: 'Overall good quality', findings: [] };
      const result = renderReviewFindings(view);
      expect(result).toContain('Overall good quality');
    });

    it('omits summary when absent', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      // Should only have findings heading
      expect(result).toContain('### Findings');
    });
  });

  describe('acceptance criteria section', () => {
    it('renders addressed criteria with checkmarks', () => {
      const ac = {
        addressed: [{ criterion: 'Login works', evidence: 'Tests pass' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('### Acceptance Criteria');
      expect(result).toContain('- ✅ Login works');
      expect(result).toContain('_Tests pass_');
    });

    it('renders addressed criteria without evidence', () => {
      const ac = {
        addressed: [{ criterion: 'Feature complete' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ✅ Feature complete');
      expect(result).not.toContain('_undefined_');
    });

    it('renders addressed criteria with missing criterion as dash', () => {
      const ac = {
        addressed: [{ evidence: 'Some evidence' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ✅ —');
    });

    it('renders partially addressed criteria', () => {
      const ac = {
        partiallyAddressed: [
          { criterion: 'Error handling', note: 'Only covers happy path' },
        ] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- 🟡 Error handling');
      expect(result).toContain('_Only covers happy path_');
    });

    it('renders partially addressed criteria without note', () => {
      const ac = {
        partiallyAddressed: [{ criterion: 'Partial work' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- 🟡 Partial work');
    });

    it('renders not addressed criteria', () => {
      const ac = {
        notAddressed: [
          { criterion: 'Performance tests', note: 'Not implemented yet' },
        ] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ❌ Performance tests');
      expect(result).toContain('_Not implemented yet_');
    });

    it('renders not addressed criteria without note', () => {
      const ac = {
        notAddressed: [{ criterion: 'Missing feature' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ❌ Missing feature');
    });

    it('renders not addressed criteria with missing criterion as dash', () => {
      const ac = {
        notAddressed: [{ note: 'Totally missing' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ❌ —');
      expect(result).toContain('_Totally missing_');
    });

    it('renders all three AC categories together', () => {
      const ac = {
        addressed: [{ criterion: 'Done' }] as ACEntry[],
        partiallyAddressed: [{ criterion: 'Half done' }] as ACEntry[],
        notAddressed: [{ criterion: 'Not done' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- ✅ Done');
      expect(result).toContain('- 🟡 Half done');
      expect(result).toContain('- ❌ Not done');
    });

    it('omits AC section when acceptanceCriteria is undefined', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Acceptance Criteria');
    });

    it('omits AC section when all arrays are empty', () => {
      const ac = {
        addressed: [] as ACEntry[],
        partiallyAddressed: [] as ACEntry[],
        notAddressed: [] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Acceptance Criteria');
    });

    it('omits AC section when all arrays are undefined', () => {
      const ac = {};
      const view: JsonObject = {
        acceptanceCriteria: ac,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Acceptance Criteria');
    });

    it('renders AC section with only partially addressed entries', () => {
      const ac = {
        partiallyAddressed: [{ criterion: 'WIP' }] as ACEntry[],
      };
      const view: JsonObject = {
        acceptanceCriteria: ac as unknown as JsonObject,
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('### Acceptance Criteria');
      expect(result).toContain('- 🟡 WIP');
      expect(result).not.toContain('✅');
      expect(result).not.toContain('❌');
    });
  });

  describe('untracked changes', () => {
    it('renders untracked changes with file and description', () => {
      const untracked: UntrackedChangeEntry[] = [
        { file: 'src/utils.ts', description: 'Added helper function' },
      ];
      const view: JsonObject = {
        untrackedChanges: untracked as unknown as JsonObject[],
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('### Untracked Changes');
      expect(result).toContain('- `src/utils.ts` — Added helper function');
    });

    it('renders dash for missing file and description', () => {
      const untracked: UntrackedChangeEntry[] = [{}];
      const view: JsonObject = {
        untrackedChanges: untracked as unknown as JsonObject[],
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- `—` — —');
    });

    it('omits untracked changes section when empty', () => {
      const view: JsonObject = {
        untrackedChanges: [],
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Untracked Changes');
    });

    it('omits untracked changes section when absent', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Untracked Changes');
    });
  });

  describe('risks', () => {
    it('renders risks with warning icons', () => {
      const view: JsonObject = {
        risks: ['Security vulnerability', 'Performance regression'],
        findings: [],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('### Risks');
      expect(result).toContain('- ⚠️ Security vulnerability');
      expect(result).toContain('- ⚠️ Performance regression');
    });

    it('omits risks section when empty', () => {
      const view: JsonObject = { risks: [], findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Risks');
    });

    it('omits risks section when absent', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### Risks');
    });
  });

  describe('findings', () => {
    it('renders numbered findings with description', () => {
      const findings: ReviewFinding[] = [
        { description: 'Missing error handling' },
        { description: 'Unused import' },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('### Findings');
      expect(result).toContain('1. Missing error handling');
      expect(result).toContain('2. Unused import');
    });

    it('renders dash for missing description', () => {
      const findings: ReviewFinding[] = [{}];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('1. —');
    });

    it('renders file in finding', () => {
      const findings: ReviewFinding[] = [{ description: 'Issue', file: 'src/main.ts' }];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('**File:** `src/main.ts`');
    });

    it('renders evidence with language extracted from file path', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Bug',
          file: 'src/utils.ts',
          evidence: 'const x = null;',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('**Evidence:**');
      expect(result).toContain('```ts');
      expect(result).toContain('const x = null;');
    });

    it('renders evidence with empty language when file has no extension', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Bug',
          file: 'Makefile',
          evidence: 'build:',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```\n');
    });

    it('renders evidence with empty language when file is absent', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Bug',
          evidence: 'some code',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```\n');
    });

    it('renders suggestion', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Issue',
          suggestion: 'Use optional chaining',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('**Suggestion:** Use optional chaining');
    });

    it('renders finding with all fields', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Null reference',
          file: 'src/handler.tsx',
          evidence: 'obj.prop',
          suggestion: 'Add null check',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('1. Null reference');
      expect(result).toContain('**File:** `src/handler.tsx`');
      expect(result).toContain('```tsx');
      expect(result).toContain('obj.prop');
      expect(result).toContain('**Suggestion:** Add null check');
    });

    it('renders "No findings" when findings array is empty', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).toContain('_No findings_');
    });

    it('renders "No findings" when findings is absent', () => {
      const view: JsonObject = {};
      const result = renderReviewFindings(view);
      expect(result).toContain('_No findings_');
    });

    it('handles multi-line evidence correctly', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Multi-line',
          file: 'app.js',
          evidence: 'line1\nline2\nline3',
        },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```js');
      expect(result).toContain('line1\nline2\nline3');
    });
  });

  describe('extractLangFromPath', () => {
    it('extracts ts from .ts file', () => {
      const findings: ReviewFinding[] = [
        { description: 'x', file: 'src/main.ts', evidence: 'code' },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```ts');
    });

    it('extracts tsx from .tsx file', () => {
      const findings: ReviewFinding[] = [
        { description: 'x', file: 'component.tsx', evidence: 'code' },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```tsx');
    });

    it('extracts py from .py file', () => {
      const findings: ReviewFinding[] = [{ description: 'x', file: 'script.py', evidence: 'code' }];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```py');
    });

    it('strips line numbers from path before extracting extension', () => {
      const findings: ReviewFinding[] = [
        { description: 'x', file: 'src/utils.ts:42', evidence: 'code' },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```ts');
    });

    it('returns empty string for files without extension', () => {
      const findings: ReviewFinding[] = [
        { description: 'x', file: 'Dockerfile', evidence: 'FROM node' },
      ];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```\n');
    });

    it('handles null/undefined file gracefully', () => {
      const findings: ReviewFinding[] = [{ description: 'x', evidence: 'code' }];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```\n');
    });

    it('lowercases the extension', () => {
      const findings: ReviewFinding[] = [{ description: 'x', file: 'App.TSX', evidence: 'code' }];
      const view: JsonObject = { findings: findings as unknown as JsonObject[] };
      const result = renderReviewFindings(view);
      expect(result).toContain('```tsx');
    });
  });

  describe('e2e test summary section', () => {
    it('renders passed e2e summary', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          framework: 'playwright',
          testCount: 5,
          results: { passed: 5, failed: 0 },
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('### E2E Test Results');
      expect(result).toContain('✅ **PASSED** — playwright');
      expect(result).toContain('5/5 passed');
    });

    it('renders failed e2e summary with failure count', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          framework: 'cypress',
          testCount: 10,
          results: { passed: 7, failed: 3 },
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('❌ **FAILED** — cypress');
      expect(result).toContain('7/10 passed');
      expect(result).toContain('3 failed');
    });

    it('renders e2e summary without test counts when missing', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          framework: 'playwright',
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('✅ **PASSED** — playwright');
      expect(result).not.toContain('/');
    });

    it('defaults framework to playwright', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: { passed: true },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('— playwright');
    });

    it('renders e2e summary with summary text', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          summary: 'All critical paths verified',
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('All critical paths verified');
    });

    it('renders e2e summary with videos', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          videos: [
            { path: '/videos/login.webm', testName: 'login test' },
            { path: '/videos/checkout.webm', testName: 'checkout test' },
          ],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('**Videos:**');
      expect(result).toContain('🎥 `/videos/login.webm` — login test');
      expect(result).toContain('🎥 `/videos/checkout.webm` — checkout test');
    });

    it('renders e2e summary videos with default name/path', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          videos: [{}],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('🎥 `` — test');
    });

    it('renders e2e summary with UI bugs', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          uiBugsFound: [{ description: 'Overlap issue', severity: 'critical', testName: 'layout' }],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('**UI Bugs Found:**');
      expect(result).toContain('[critical] Overlap issue _(found in: layout)_');
    });

    it('renders e2e summary bugs without severity prefix when missing', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          uiBugsFound: [{ description: 'Bug with no severity' }],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- Bug with no severity _(found in: —)_');
      expect(result).not.toContain('[] ');
    });

    it('renders e2e summary bugs with missing description and testName', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          uiBugsFound: [{ severity: 'major' }],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('[major] — _(found in: —)_');
    });

    it('renders e2e summary with failures', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          failures: [
            { test: 'login test', error: 'Timeout waiting for selector' },
            { test: 'signup test', error: 'Network error' },
          ],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('**Failures:**');
      expect(result).toContain('- **login test:** Timeout waiting for selector');
      expect(result).toContain('- **signup test:** Network error');
    });

    it('renders e2e failures with missing test and error', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          failures: [{}],
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('- **—:** unknown error');
    });

    it('renders e2e summary without results when testCount is present but results is missing', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          testCount: 5,
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('✅ **PASSED** — playwright');
      expect(result).not.toContain('/5');
    });

    it('omits failed count when results.failed is 0', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: true,
          testCount: 3,
          results: { passed: 3, failed: 0 },
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('3/3 passed');
      expect(result).not.toContain('failed');
    });

    it('defaults passed count to 0 when missing in results', () => {
      const view: JsonObject = {
        findings: [],
        e2eTestSummary: {
          passed: false,
          testCount: 5,
          results: { failed: 5 },
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('0/5 passed');
    });

    it('omits e2e test summary section when absent', () => {
      const view: JsonObject = { findings: [] };
      const result = renderReviewFindings(view);
      expect(result).not.toContain('### E2E Test Results');
    });
  });

  describe('remaining/extra fields', () => {
    it('renders extra fields not in known keys via renderObject', () => {
      const view: JsonObject = {
        findings: [],
        customField: 'custom value',
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('Custom Field');
      expect(result).toContain('custom value');
    });

    it('does not render known keys in extra section', () => {
      const view: JsonObject = {
        title: 'Review',
        summary: 'Good',
        findings: [],
      };
      const result = renderReviewFindings(view);
      // Known keys like title, summary should not appear in extra section
      // The title appears as heading, summary as its own section
      const sections = result.split('\n\n');
      const afterFindings = sections.slice(sections.indexOf('### Findings'));
      const joined = afterFindings.join('\n');
      // Should not have title or summary in the extra rendered object
      expect(joined).not.toContain('**Title:**');
      expect(joined).not.toContain('**Summary:**');
    });

    it('omits metadata keys (id, version, createdAt, updatedAt) from extra fields', () => {
      const view: JsonObject = {
        findings: [],
        id: 'abc-123',
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      const result = renderReviewFindings(view);
      // Metadata keys should be filtered out
      expect(result).not.toContain('abc-123');
    });

    it('does not render extra section when no unknown keys exist', () => {
      const view: JsonObject = {
        title: 'Review',
        summary: 'Summary',
        findings: [],
      };
      const result = renderReviewFindings(view);
      // The output should only contain title, summary, and findings sections
      const sections = result.split('\n\n');
      const lastSection = sections[sections.length - 1];
      expect(lastSection).toBe('_No findings_');
    });
  });

  describe('full integration', () => {
    it('renders a complete review findings with all sections', () => {
      const findings: ReviewFinding[] = [
        {
          description: 'Missing null check',
          file: 'src/api.ts',
          evidence: 'return data.value;',
          suggestion: 'Add optional chaining',
        },
      ];
      const ac = {
        addressed: [{ criterion: 'API endpoint works', evidence: 'Integration test passes' }],
        partiallyAddressed: [{ criterion: 'Error handling', note: 'Only 4xx covered' }],
        notAddressed: [{ criterion: 'Rate limiting', note: 'Deferred to next sprint' }],
      };
      const view: JsonObject = {
        title: 'Context: API Review',
        summary: 'Generally good code quality',
        acceptanceCriteria: ac,
        untrackedChanges: [{ file: 'config.json', description: 'Updated settings' }],
        risks: ['Breaking change in API contract'],
        findings: findings as unknown as JsonObject[],
        e2eTestSummary: {
          passed: true,
          framework: 'playwright',
          testCount: 3,
          results: { passed: 3, failed: 0 },
          summary: 'All E2E tests passed',
        },
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('# API Review');
      expect(result).toContain('Generally good code quality');
      expect(result).toContain('### Acceptance Criteria');
      expect(result).toContain('- ✅ API endpoint works');
      expect(result).toContain('- 🟡 Error handling');
      expect(result).toContain('- ❌ Rate limiting');
      expect(result).toContain('### Untracked Changes');
      expect(result).toContain('`config.json`');
      expect(result).toContain('### Risks');
      expect(result).toContain('⚠️ Breaking change in API contract');
      expect(result).toContain('### Findings');
      expect(result).toContain('1. Missing null check');
      expect(result).toContain('```ts');
      expect(result).toContain('**Suggestion:** Add optional chaining');
      expect(result).toContain('### E2E Test Results');
      expect(result).toContain('✅ **PASSED** — playwright');
      expect(result).toContain('3/3 passed');
      expect(result).toContain('All E2E tests passed');
    });

    it('renders minimal view with empty object', () => {
      const view: JsonObject = {};
      const result = renderReviewFindings(view);
      expect(result).toContain('### Findings');
      expect(result).toContain('_No findings_');
    });

    it('sections are separated by double newlines', () => {
      const view: JsonObject = {
        title: 'Test',
        summary: 'Summary',
        findings: [{ description: 'Finding' }],
      };
      const result = renderReviewFindings(view);
      expect(result).toContain('\n\n');
      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });
  });
});
