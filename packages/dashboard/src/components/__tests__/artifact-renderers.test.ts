import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SPEC_SECTIONS,
  renderAnalysisSection,
  renderArtifactAsMarkdown,
} from '../artifact-renderers';

describe('renderArtifactAsMarkdown', () => {
  it('returns raw string for invalid JSON', () => {
    expect(renderArtifactAsMarkdown('not json')).toBe('not json');
  });

  it('wraps primitive values in a JSON code block', () => {
    const result = renderArtifactAsMarkdown('42');
    expect(result).toContain('```json');
    expect(result).toContain('42');
  });

  it('wraps null in a JSON code block', () => {
    const result = renderArtifactAsMarkdown('null');
    expect(result).toContain('```json');
    expect(result).toContain('null');
  });

  it('returns "_No items_" for empty array', () => {
    expect(renderArtifactAsMarkdown('[]')).toBe('_No items_');
  });

  it('renders an array of objects with titles', () => {
    const json = JSON.stringify([
      { title: 'First', value: 1 },
      { title: 'Second', value: 2 },
    ]);
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('## First');
    expect(result).toContain('## Second');
  });

  it('renders an array of primitives as JSON code block', () => {
    const json = JSON.stringify([1, 2, 3]);
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('```json');
  });

  it('renders generic object with title', () => {
    const json = JSON.stringify({ title: 'My Object', status: 'active' });
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('# My Object');
    expect(result).toContain('**Status:** active');
  });

  it('renders generic object with name fallback', () => {
    const json = JSON.stringify({ name: 'widget', count: 5 });
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('# widget');
    expect(result).toContain('**Count:** 5');
  });

  it('renders metadata fields', () => {
    const json = JSON.stringify({ id: 'abc', version: 2, title: 'Test' });
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('**Id:** abc');
    expect(result).toContain('**Version:** 2');
  });

  describe('canonical_specification renderer', () => {
    it('renders a canonical specification with sections', () => {
      const spec = {
        title: 'My Spec',
        businessGoal: 'Make things better',
        risks: [{ id: 'R1', description: 'Something bad', mitigation: 'Be careful' }],
        definitionOfDone: ['All tests pass', 'Code reviewed'],
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(spec), 'canonical_specification');
      expect(result).toContain('# My Spec');
      expect(result).toContain('Make things better');
      expect(result).toContain('## Risks');
      expect(result).toContain('**R1:** Something bad');
      expect(result).toContain('_Mitigation:_ Be careful');
      expect(result).toContain('## Definition of Done');
      expect(result).toContain('- All tests pass');
    });
  });

  describe('judge_decision renderer', () => {
    it('renders verdict and reasoning', () => {
      const decision = {
        verdict: 'Approved',
        reasoning: 'Meets all criteria',
        scores: { quality: 9, completeness: 8 },
        conditions: ['Must add tests'],
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(decision), 'judge_decision');
      expect(result).toContain('# Judge Decision: Approved');
      expect(result).toContain('## Reasoning');
      expect(result).toContain('Meets all criteria');
      expect(result).toContain('## Scores');
      expect(result).toContain('## Conditions');
      expect(result).toContain('- Must add tests');
    });
  });

  describe('clarification_questions renderer', () => {
    it('renders clarification questions', () => {
      const data = {
        questions: [{ question: 'What is the scope?', answer: 'Everything' }],
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'clarification_questions');
      expect(result).toContain('Clarification');
      expect(result).toContain('**Q:** What is the scope?');
      expect(result).toContain('**A:** Everything');
    });
  });

  describe('agreement renderer', () => {
    it('renders a planning agreement', () => {
      const data = {
        type: 'planning_agreement',
        status: 'approved',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'planning_agreement');
      expect(result).toContain('Planning Agreement');
      expect(result).toContain('**Status:** approved');
    });
  });

  describe('review_findings renderer', () => {
    it('renders numbered findings with file paths in backticks', () => {
      const data = {
        version: 1,
        findings: [
          {
            description: 'SQL injection vulnerability',
            file: 'src/api/search.ts:34',
            suggestion: 'Use parameterized queries',
          },
          {
            description: 'Missing error boundary',
            file: 'src/components/Dashboard.tsx:12',
            suggestion: 'Wrap in ErrorBoundary',
          },
        ],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('### Findings');
      expect(result).toContain('1. SQL injection vulnerability');
      expect(result).toContain('**File:** `src/api/search.ts:34`');
      expect(result).toContain('**Suggestion:** Use parameterized queries');
      expect(result).toContain('2. Missing error boundary');
      expect(result).not.toContain('---');
      expect(result).not.toContain('Version');
      expect(result).not.toContain('Created At');
    });

    it('renders evidence as a code block when present', () => {
      const data = {
        version: 1,
        findings: [
          {
            description: 'SQL injection via string interpolation',
            file: 'src/api/search.ts:34',
            suggestion: 'Use parameterized queries',
            evidence: "db.query(`SELECT * FROM users WHERE name = '${req.query.q}'`);",
          },
        ],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('**Evidence:**');
      expect(result).toContain('```');
      expect(result).toContain('db.query');
    });

    it('omits evidence block when field is absent', () => {
      const data = {
        version: 1,
        findings: [
          {
            description: 'Minor style issue',
            file: 'src/index.ts',
            suggestion: 'Run formatter',
          },
        ],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).not.toContain('**Evidence:**');
    });

    it('renders empty findings', () => {
      const data = { version: 1, findings: [], createdAt: '2026-07-21T14:30:00Z' };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('### Findings');
      expect(result).toContain('_No findings_');
    });

    it('renders title without verdict', () => {
      const data = {
        version: 1,
        title: 'Add rate limiting',
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('# Add rate limiting');
      expect(result).not.toContain('Verdict');
    });

    it('renders summary text', () => {
      const data = {
        version: 1,
        summary: 'Overall quality is good with one minor issue.',
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('Overall quality is good with one minor issue.');
    });

    it('renders acceptance criteria with addressed and not addressed', () => {
      const data = {
        version: 1,
        acceptanceCriteria: {
          addressed: [
            { criterion: 'Rate limit per API key', evidence: 'Implemented in rate-limiter.ts' },
          ],
          notAddressed: [{ criterion: 'Admin dashboard metrics', note: 'Not in this PR' }],
        },
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('### Acceptance Criteria');
      expect(result).toContain('✅ Rate limit per API key');
      expect(result).toContain('Implemented in rate-limiter.ts');
      expect(result).toContain('❌ Admin dashboard metrics');
      expect(result).toContain('Not in this PR');
    });

    it('omits acceptance criteria when not present', () => {
      const data = {
        version: 1,
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).not.toContain('### Acceptance Criteria');
    });

    it('renders untracked changes with file paths', () => {
      const data = {
        version: 1,
        untrackedChanges: [
          { file: 'src/config/redis.ts', description: 'Refactored connection pooling' },
          { file: 'src/utils/logger.ts', description: 'Updated log format' },
        ],
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('### Untracked Changes');
      expect(result).toContain('`src/config/redis.ts`');
      expect(result).toContain('Refactored connection pooling');
      expect(result).toContain('`src/utils/logger.ts`');
      expect(result).toContain('Updated log format');
    });

    it('omits untracked changes when not present', () => {
      const data = { version: 1, findings: [], createdAt: '2026-07-21T14:30:00Z' };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).not.toContain('### Untracked Changes');
    });

    it('renders risks as a bulleted list', () => {
      const data = {
        version: 1,
        risks: [
          'Touches shared infrastructure used by caching layer',
          'No load test evidence for threshold',
        ],
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).toContain('### Risks');
      expect(result).toContain('Touches shared infrastructure used by caching layer');
      expect(result).toContain('No load test evidence for threshold');
    });

    it('omits risks when not present', () => {
      const data = { version: 1, findings: [], createdAt: '2026-07-21T14:30:00Z' };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).not.toContain('### Risks');
    });

    it('does not render known fields as leftover JSON', () => {
      const data = {
        version: 1,
        title: 'Test PR',
        summary: 'All good.',
        acceptanceCriteria: {
          addressed: [{ criterion: 'AC1' }],
        },
        untrackedChanges: [{ file: 'src/foo.ts', description: 'Extra change' }],
        risks: ['Touches shared infra'],
        findings: [],
        createdAt: '2026-07-21T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_findings');
      expect(result).not.toContain('"title"');
      expect(result).not.toContain('"summary"');
      expect(result).not.toContain('"acceptanceCriteria"');
      expect(result).not.toContain('"untrackedChanges"');
      expect(result).not.toContain('"risks"');
    });
  });

  describe('review_report renderer', () => {
    it('renders report heading with verdict', () => {
      const data = {
        version: 1,
        approved: false,
        summary: 'Critical SQL injection found.',
        verdict: 'request_changes',
        findings: [],
        reviewSummary: { totalFindings: 0, critical: 0, major: 0, minor: 0 },
        createdAt: '2026-07-22T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_report');
      expect(result).toContain('# Review Report: request_changes');
      expect(result).toContain('Critical SQL injection found.');
    });

    it('renders findings with severity indicators and evidence', () => {
      const data = {
        version: 1,
        approved: false,
        summary: 'Issues found.',
        verdict: 'request_changes',
        findings: [
          {
            id: 'SYN-001',
            category: 'security',
            severity: 'critical',
            description: 'SQL injection in search endpoint.',
            sources: ['security_reviewer', 'static_reviewer'],
            file: 'src/api/search.ts',
            line: 34,
            suggestion: 'Use parameterized queries.',
            evidence: "db.query(`SELECT * FROM users WHERE name = '${q}'`);",
          },
          {
            id: 'SYN-002',
            category: 'maintainability',
            severity: 'minor',
            description: 'Magic number without named constant.',
            sources: ['static_reviewer'],
            file: 'src/config/cache.ts',
            line: 15,
            suggestion: 'Extract to a named constant.',
            evidence: null,
          },
        ],
        reviewSummary: { totalFindings: 2, critical: 1, major: 0, minor: 1 },
        createdAt: '2026-07-22T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_report');
      expect(result).toContain('## Findings');
      expect(result).toContain('🔴');
      expect(result).toContain('**SYN-001**');
      expect(result).toContain('critical');
      expect(result).toContain('security');
      expect(result).toContain('**File:** `src/api/search.ts:34`');
      expect(result).toContain('**Evidence:**');
      expect(result).toContain('```');
      expect(result).toContain('db.query');
      expect(result).toContain('**Suggestion:** Use parameterized queries.');
      expect(result).toContain('security_reviewer, static_reviewer');
      expect(result).toContain('🟡');
      expect(result).toContain('**SYN-002**');
    });

    it('renders review summary statistics', () => {
      const data = {
        version: 1,
        approved: true,
        summary: 'All clear.',
        verdict: 'approve',
        findings: [],
        reviewSummary: { totalFindings: 0, critical: 0, major: 0, minor: 0 },
        createdAt: '2026-07-22T14:30:00Z',
      };
      const result = renderArtifactAsMarkdown(JSON.stringify(data), 'review_report');
      expect(result).toContain('# Review Report: approve');
      expect(result).toContain('**Total Findings:** 0');
      expect(result).toContain('_No findings_');
    });

    it('renders individual review types using review report renderer', () => {
      const data = {
        version: 1,
        approved: true,
        summary: 'No security issues found.',
        findings: [],
        createdAt: '2026-07-22T14:30:00Z',
      };
      for (const type of [
        'static_review',
        'security_review',
        'performance_review',
        'adversarial_review',
        'design_review',
        'docs_review',
        'ux_review',
        'plan_review',
      ]) {
        const result = renderArtifactAsMarkdown(JSON.stringify(data), type);
        expect(result).toContain('# Review Report: approve');
        expect(result).toContain('_No findings_');
      }
    });
  });

  it('falls back to generic renderer for unknown type', () => {
    const json = JSON.stringify({ title: 'Fallback', data: 'value' });
    const result = renderArtifactAsMarkdown(json, 'unknown_type');
    expect(result).toContain('# Fallback');
  });

  it('renders booleans as Yes/No', () => {
    const json = JSON.stringify({ enabled: true, disabled: false });
    const result = renderArtifactAsMarkdown(json);
    expect(result).toContain('Yes');
    expect(result).toContain('No');
  });
});

describe('CANONICAL_SPEC_SECTIONS', () => {
  it('contains entries for all expected section keys', () => {
    const keys = CANONICAL_SPEC_SECTIONS.map((e) => e.key);
    expect(keys).toEqual([
      'businessGoal',
      'stakeholders',
      'assumptions',
      'constraints',
      'functionalRequirements',
      'nonFunctionalRequirements',
      'acceptanceCriteria',
      'risks',
      'definitionOfDone',
      'sources',
    ]);
  });

  it('returns undefined for missing/empty sections', () => {
    const emptyView = { title: 'T' };
    for (const entry of CANONICAL_SPEC_SECTIONS) {
      expect(entry.render(emptyView)).toBeUndefined();
    }
  });

  it('renders businessGoal as blockquote', () => {
    const view = { title: 'T', businessGoal: 'Goal text' };
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'businessGoal');
    expect(entry?.render(view)).toBe('> Goal text');
  });

  it('renders stakeholders via renderIdDescriptionList', () => {
    const view = {
      title: 'T',
      stakeholders: [{ name: 'Alice', role: 'PM', interest: 'Delivery' }],
    };
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'stakeholders');
    const result = entry?.render(view);
    expect(result).toContain('## Stakeholders');
    expect(result).toContain('Alice');
    expect(result).toContain('PM');
  });

  it('renders assumptions via renderIdDescriptionList', () => {
    const view = {
      title: 'T',
      assumptions: [{ id: 'A1', description: 'Some assumption' }],
    };
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'assumptions');
    const result = entry?.render(view);
    expect(result).toContain('## Assumptions');
    expect(result).toContain('A1');
  });

  it('renders risks with heading', () => {
    const view = {
      title: 'T',
      risks: [{ id: 'R1', description: 'Bad thing', mitigation: 'Handle it' }],
    };
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'risks');
    const result = entry?.render(view);
    expect(result).toContain('## Risks');
    expect(result).toContain('**R1:** Bad thing');
    expect(result).toContain('_Mitigation:_ Handle it');
  });

  it('renders definitionOfDone as bullet list', () => {
    const view = {
      title: 'T',
      definitionOfDone: ['Tests pass', 'Code reviewed'],
    };
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'definitionOfDone');
    const result = entry?.render(view);
    expect(result).toContain('## Definition of Done');
    expect(result).toContain('- Tests pass');
    expect(result).toContain('- Code reviewed');
  });
});

describe('renderAnalysisSection', () => {
  it('returns empty string when analysis has no content', () => {
    expect(renderAnalysisSection({})).toBe('');
  });

  it('renders completeness score', () => {
    const result = renderAnalysisSection({ completenessScore: 0.85 });
    expect(result).toContain('## Analysis');
    expect(result).toContain('**Completeness:** 85%');
  });

  it('renders completeness score of zero', () => {
    const result = renderAnalysisSection({ completenessScore: 0 });
    expect(result).toContain('**Completeness:** 0%');
  });

  it('renders assumptions list', () => {
    const result = renderAnalysisSection({ assumptions: ['Assume A', 'Assume B'] });
    expect(result).toContain('### Assumptions');
    expect(result).toContain('- Assume A');
    expect(result).toContain('- Assume B');
  });

  it('renders requirements table', () => {
    const result = renderAnalysisSection({
      requirements: [{ id: 'REQ-1', priority: 'High', description: 'Do X' }],
    });
    expect(result).toContain('### Requirements');
    expect(result).toContain('REQ-1');
    expect(result).toContain('High');
  });

  it('renders risks', () => {
    const result = renderAnalysisSection({
      risks: [{ id: 'R1', description: 'Risk one' }],
    });
    expect(result).toContain('### Risks');
    expect(result).toContain('**R1:** Risk one');
  });

  it('renders string ambiguities', () => {
    const result = renderAnalysisSection({ ambiguities: ['Unclear scope'] });
    expect(result).toContain('### Ambiguities');
    expect(result).toContain('- Unclear scope');
  });

  it('renders object ambiguities with impact', () => {
    const result = renderAnalysisSection({
      ambiguities: [{ description: 'Vague', impact: 'Delays' }],
    });
    expect(result).toContain('- Vague');
    expect(result).toContain('_Impact:_ Delays');
  });

  it('renders scope boundary', () => {
    const result = renderAnalysisSection({
      scopeBoundary: { inScope: ['Feature A'], outOfScope: ['Feature B'] },
    });
    expect(result).toContain('### Scope');
    expect(result).toContain('**In Scope:**');
    expect(result).toContain('- Feature A');
    expect(result).toContain('**Out of Scope:**');
    expect(result).toContain('- Feature B');
  });

  it('renders technical context', () => {
    const result = renderAnalysisSection({
      technicalContext: { language: 'TypeScript', framework: 'Node.js' },
    });
    expect(result).toContain('### Technical Context');
    expect(result).toContain('**Language:** TypeScript');
    expect(result).toContain('**Framework:** Node.js');
  });

  it('renders all sub-sections together', () => {
    const result = renderAnalysisSection({
      completenessScore: 0.7,
      assumptions: ['One'],
      risks: ['A risk'],
      technicalContext: { db: 'postgres' },
    });
    expect(result).toContain('## Analysis');
    expect(result).toContain('### Assumptions');
    expect(result).toContain('### Risks');
    expect(result).toContain('### Technical Context');
  });
});
