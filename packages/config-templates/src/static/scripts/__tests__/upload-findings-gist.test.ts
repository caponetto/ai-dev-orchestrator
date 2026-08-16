import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FindingsDoc } from '../upload-findings-gist';
import {
  collectMarkdownOrJsonFiles,
  findLatestFindings,
  langFromPath,
  loadFindingsDoc,
  renderFindingsMarkdown,
} from '../upload-findings-gist';

describe('langFromPath', () => {
  it('returns empty string for null', () => {
    expect(langFromPath(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(langFromPath(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(langFromPath('')).toBe('');
  });

  it('extracts ts extension', () => {
    expect(langFromPath('src/handler.ts')).toBe('ts');
  });

  it('extracts tsx extension', () => {
    expect(langFromPath('components/App.tsx')).toBe('tsx');
  });

  it('extracts json extension', () => {
    expect(langFromPath('package.json')).toBe('json');
  });

  it('strips trailing line number before extracting', () => {
    expect(langFromPath('src/handler.ts:42')).toBe('ts');
  });

  it('returns empty string for file without extension', () => {
    expect(langFromPath('Makefile')).toBe('');
  });
});

describe('collectMarkdownOrJsonFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upload-findings-gist-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects .md files', () => {
    writeFileSync(join(tmpDir, 'findings.md'), '# Findings', 'utf-8');
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(tmpDir, out);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toContain('findings.md');
  });

  it('collects .json files', () => {
    writeFileSync(join(tmpDir, 'report.json'), '{}', 'utf-8');
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(tmpDir, out);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toContain('report.json');
  });

  it('ignores files with other extensions', () => {
    writeFileSync(join(tmpDir, 'data.txt'), 'text', 'utf-8');
    writeFileSync(join(tmpDir, 'code.ts'), 'code', 'utf-8');
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(tmpDir, out);
    expect(out).toHaveLength(0);
  });

  it('ignores directories', () => {
    mkdirSync(join(tmpDir, 'subdir.md'));
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(tmpDir, out);
    expect(out).toHaveLength(0);
  });

  it('handles non-existent directory gracefully', () => {
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(join(tmpDir, 'nonexistent'), out);
    expect(out).toHaveLength(0);
  });

  it('collects multiple files and records mtime', () => {
    writeFileSync(join(tmpDir, 'a.md'), 'a', 'utf-8');
    writeFileSync(join(tmpDir, 'b.json'), '{}', 'utf-8');
    const out: { path: string; mtime: number }[] = [];
    collectMarkdownOrJsonFiles(tmpDir, out);
    expect(out).toHaveLength(2);
    expect(out.every((c) => typeof c.mtime === 'number')).toBe(true);
  });
});

describe('findLatestFindings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upload-findings-gist-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no review_findings directory exists', () => {
    expect(findLatestFindings(tmpDir)).toBeNull();
  });

  it('finds file in review_findings directory', () => {
    const findingsDir = join(tmpDir, 'review_findings');
    mkdirSync(findingsDir, { recursive: true });
    writeFileSync(join(findingsDir, 'report.json'), '{}', 'utf-8');
    const result = findLatestFindings(tmpDir);
    expect(result).toContain('report.json');
  });

  it('falls back to artifacts/review_findings when top-level is empty', () => {
    const nestedDir = join(tmpDir, 'artifacts', 'review_findings');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'report.md'), '# Report', 'utf-8');
    const result = findLatestFindings(tmpDir);
    expect(result).toContain(join('artifacts', 'review_findings', 'report.md'));
  });

  it('prefers top-level review_findings over nested when both exist', () => {
    const topDir = join(tmpDir, 'review_findings');
    mkdirSync(topDir, { recursive: true });
    writeFileSync(join(topDir, 'top.json'), '{}', 'utf-8');

    const nestedDir = join(tmpDir, 'artifacts', 'review_findings');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'nested.json'), '{}', 'utf-8');

    const result = findLatestFindings(tmpDir);
    expect(result).toContain('top.json');
  });

  it('returns the most recently modified file', () => {
    const findingsDir = join(tmpDir, 'review_findings');
    mkdirSync(findingsDir, { recursive: true });
    writeFileSync(join(findingsDir, 'old.json'), '{"old": true}', 'utf-8');

    const laterTime = Date.now() + 1000;
    writeFileSync(join(findingsDir, 'new.json'), '{"new": true}', 'utf-8');
    utimesSync(join(findingsDir, 'new.json'), laterTime / 1000, laterTime / 1000);

    const result = findLatestFindings(tmpDir);
    expect(result).toContain('new.json');
  });

  it('returns null when review_findings directory exists but is empty', () => {
    mkdirSync(join(tmpDir, 'review_findings'), { recursive: true });
    expect(findLatestFindings(tmpDir)).toBeNull();
  });
});

describe('loadFindingsDoc', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upload-findings-gist-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses valid JSON into FindingsDoc', () => {
    const doc = { title: 'Review', summary: 'All good', findings: [] };
    const filePath = join(tmpDir, 'report.json');
    writeFileSync(filePath, JSON.stringify(doc), 'utf-8');
    const result = loadFindingsDoc(filePath);
    expect(result.title).toBe('Review');
    expect(result.summary).toBe('All good');
    expect(result.findings).toEqual([]);
  });

  it('wraps non-JSON content as summary', () => {
    const filePath = join(tmpDir, 'report.md');
    writeFileSync(filePath, '# Some Markdown\n\nNot JSON.', 'utf-8');
    const result = loadFindingsDoc(filePath);
    expect(result.summary).toBe('# Some Markdown\n\nNot JSON.');
    expect(result.title).toBeUndefined();
  });

  it('handles JSON with all fields', () => {
    const doc: FindingsDoc = {
      title: 'Context: PR Review',
      summary: 'Issues found.',
      findings: [{ description: 'Bug', file: 'src/a.ts', severity: 'major' }],
      risks: ['Performance regression'],
      acceptanceCriteria: {
        addressed: [{ criterion: 'AC-1', evidence: 'Done' }],
      },
    };
    const filePath = join(tmpDir, 'full.json');
    writeFileSync(filePath, JSON.stringify(doc), 'utf-8');
    const result = loadFindingsDoc(filePath);
    expect(result.title).toBe('Context: PR Review');
    expect(result.findings).toHaveLength(1);
    expect(result.risks).toEqual(['Performance regression']);
  });
});

describe('renderFindingsMarkdown', () => {
  it('renders title without Context: prefix', () => {
    const md = renderFindingsMarkdown({ title: 'Context: Add auth' });
    expect(md).toContain('# Add auth');
    expect(md).not.toContain('Context:');
  });

  it('renders title as-is when no Context: prefix', () => {
    const md = renderFindingsMarkdown({ title: 'Add auth' });
    expect(md).toContain('# Add auth');
  });

  it('renders summary', () => {
    const md = renderFindingsMarkdown({ summary: 'All checks passed.' });
    expect(md).toContain('All checks passed.');
  });

  it('renders "No findings" when findings array is empty', () => {
    const md = renderFindingsMarkdown({ findings: [] });
    expect(md).toContain('_No findings_');
  });

  it('renders "No findings" when findings is undefined', () => {
    const md = renderFindingsMarkdown({});
    expect(md).toContain('_No findings_');
  });

  it('renders numbered findings with description', () => {
    const md = renderFindingsMarkdown({
      findings: [{ description: 'First issue' }, { description: 'Second issue' }],
    });
    expect(md).toContain('1. First issue');
    expect(md).toContain('2. Second issue');
  });

  it('renders finding with file', () => {
    const md = renderFindingsMarkdown({
      findings: [{ description: 'Bug', file: 'src/handler.ts' }],
    });
    expect(md).toContain('**File:** `src/handler.ts`');
  });

  it('renders finding with evidence in fenced code block', () => {
    const md = renderFindingsMarkdown({
      findings: [
        {
          description: 'Bug',
          file: 'src/handler.ts',
          evidence: 'const x = null;',
        },
      ],
    });
    expect(md).toContain('**Evidence:**');
    expect(md).toContain('```ts');
    expect(md).toContain('const x = null;');
  });

  it('renders finding with suggestion', () => {
    const md = renderFindingsMarkdown({
      findings: [{ description: 'Bug', suggestion: 'Use a guard clause.' }],
    });
    expect(md).toContain('**Suggestion:** Use a guard clause.');
  });

  it('renders finding with dash when description is missing', () => {
    const md = renderFindingsMarkdown({ findings: [{}] });
    expect(md).toContain('1. —');
  });

  it('renders acceptance criteria with all categories', () => {
    const md = renderFindingsMarkdown({
      acceptanceCriteria: {
        addressed: [{ criterion: 'AC-1', evidence: 'Implemented' }],
        partiallyAddressed: [{ criterion: 'AC-2', note: 'WIP' }],
        notAddressed: [{ criterion: 'AC-3', note: 'Skipped' }],
      },
    });
    expect(md).toContain('### Acceptance Criteria');
    expect(md).toContain('✅ AC-1');
    expect(md).toContain('_Implemented_');
    expect(md).toContain('🟡 AC-2');
    expect(md).toContain('_WIP_');
    expect(md).toContain('❌ AC-3');
    expect(md).toContain('_Skipped_');
  });

  it('omits acceptance criteria section when all arrays are empty', () => {
    const md = renderFindingsMarkdown({
      acceptanceCriteria: { addressed: [], notAddressed: [] },
    });
    expect(md).not.toContain('### Acceptance Criteria');
  });

  it('renders untracked changes', () => {
    const md = renderFindingsMarkdown({
      untrackedChanges: [{ file: 'src/config.ts', description: 'Refactored pooling' }],
    });
    expect(md).toContain('### Untracked Changes');
    expect(md).toContain('`src/config.ts`');
    expect(md).toContain('Refactored pooling');
  });

  it('renders risks', () => {
    const md = renderFindingsMarkdown({
      risks: ['No load test', 'Missing rollback plan'],
    });
    expect(md).toContain('### Risks');
    expect(md).toContain('⚠️ No load test');
    expect(md).toContain('⚠️ Missing rollback plan');
  });

  it('renders full document with all sections', () => {
    const doc: FindingsDoc = {
      title: 'Context: Add search endpoint',
      summary: 'Critical SQL injection found.',
      findings: [
        {
          description: 'SQL injection via string concatenation.',
          file: 'src/api/search.ts',
          suggestion: 'Use parameterized queries.',
          evidence: "db.query(`SELECT * FROM users WHERE name = '${q}'`);",
        },
      ],
      risks: ['No load testing'],
      untrackedChanges: [{ file: 'src/config.ts', description: 'Unrelated config change' }],
      acceptanceCriteria: {
        addressed: [{ criterion: 'Full-text search', evidence: 'Implemented in search.ts' }],
        notAddressed: [{ criterion: 'Pagination', note: 'Deferred' }],
      },
    };

    const md = renderFindingsMarkdown(doc);
    expect(md).toContain('# Add search endpoint');
    expect(md).toContain('Critical SQL injection found.');
    expect(md).toContain('### Acceptance Criteria');
    expect(md).toContain('### Untracked Changes');
    expect(md).toContain('### Risks');
    expect(md).toContain('### Findings');
    expect(md).toContain('1. SQL injection via string concatenation.');
    expect(md).toContain('```ts');
    expect(md).toContain('**Suggestion:** Use parameterized queries.');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('uses empty string for code fence when file has no extension', () => {
    const md = renderFindingsMarkdown({
      findings: [{ description: 'Issue', file: 'Makefile', evidence: 'all: build' }],
    });
    expect(md).toContain('```\n');
  });

  it('indents multiline evidence', () => {
    const md = renderFindingsMarkdown({
      findings: [
        {
          description: 'Bug',
          file: 'src/a.ts',
          evidence: 'line1\nline2\nline3',
        },
      ],
    });
    expect(md).toContain('   line1\n   line2\n   line3');
  });
});
