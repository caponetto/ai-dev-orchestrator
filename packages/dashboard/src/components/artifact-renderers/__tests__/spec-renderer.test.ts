import { describe, expect, it } from 'vitest';

import type { CanonicalSpecView, SpecAnalysisSection } from '../shared';
import {
  CANONICAL_SPEC_SECTIONS,
  renderAnalysisSection,
  renderCanonicalSpecification,
} from '../spec-renderer';

// ---------------------------------------------------------------------------
// renderCanonicalSpecification
// ---------------------------------------------------------------------------
describe('renderCanonicalSpecification', () => {
  it('renders the title as a level-1 heading', () => {
    const view: CanonicalSpecView = { title: 'My Specification' };
    const result = renderCanonicalSpecification(view);
    expect(result).toContain('# My Specification');
  });

  it('renders metadata when id and version are present', () => {
    const view = { title: 'Spec', id: 'spec-001', version: 3 } as CanonicalSpecView & {
      id: string;
      version: number;
    };
    const result = renderCanonicalSpecification(view);
    expect(result).toContain('**Id:** spec-001');
    expect(result).toContain('**Version:** 3');
  });

  it('omits metadata line when no metadata keys are present', () => {
    const view: CanonicalSpecView = { title: 'No Meta Spec' };
    const result = renderCanonicalSpecification(view);
    // The title should be followed by section content (or end), not by a metadata line
    const lines = result.split('\n\n');
    // First section is the title; second should NOT be a metadata line
    expect(lines[0]).toBe('# No Meta Spec');
    // If metadata were present, it would contain " · " or "**Id:**"
    if (lines.length > 1) {
      expect(lines[1]).not.toContain('**Id:**');
      expect(lines[1]).not.toContain('**Version:**');
    }
  });

  it('renders the analysis section when present and non-empty', () => {
    const view: CanonicalSpecView = {
      title: 'Spec',
      analysis: { completenessScore: 0.92 },
    };
    const result = renderCanonicalSpecification(view);
    expect(result).toContain('## Analysis');
    expect(result).toContain('**Completeness:** 92%');
  });

  it('does not render analysis heading when analysis object is empty', () => {
    const view: CanonicalSpecView = {
      title: 'Spec',
      analysis: {},
    };
    const result = renderCanonicalSpecification(view);
    expect(result).not.toContain('## Analysis');
    expect(result).not.toContain('### Assumptions');
  });

  it('renders extra fields not covered by known sections', () => {
    const view = {
      title: 'Spec',
      customField: 'custom value',
      anotherExtra: 42,
    } as unknown as CanonicalSpecView;
    const result = renderCanonicalSpecification(view);
    expect(result).toContain('**Custom Field:** custom value');
    expect(result).toContain('**Another Extra:** 42');
  });

  it('does not render remaining section when all fields are handled', () => {
    const view: CanonicalSpecView = {
      title: 'Fully Handled',
      businessGoal: 'Ship it',
    };
    const result = renderCanonicalSpecification(view);
    // Should have title, business goal, and nothing else
    const sections = result.split('\n\n');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toBe('# Fully Handled');
    expect(sections[1]).toBe('> Ship it');
  });

  it('skips canonical section rendering for empty arrays but they appear as remaining fields', () => {
    // When a section array is empty, the canonical renderer returns undefined
    // (does not add the key to "handled"), so the key falls through to the
    // generic remaining-fields renderer via renderObject.
    const view: CanonicalSpecView = {
      title: 'Empty Arrays',
      assumptions: [],
      constraints: [],
      risks: [],
    };
    const result = renderCanonicalSpecification(view);
    // The canonical "## Risks\n" heading format (with the extra newline from renderRisks)
    // is NOT used; instead renderObject renders them as generic headings with _none_
    expect(result).toContain('_none_');
  });

  it('renders stakeholders with partial fields (missing name, role, or interest)', () => {
    const view: CanonicalSpecView = {
      title: 'Spec',
      stakeholders: [{ name: 'Alice' }, { role: 'Engineer' }, { interest: 'Performance' }, {}],
    };
    const result = renderCanonicalSpecification(view);
    expect(result).toContain('## Stakeholders');
    // name maps to id, role maps to title, interest maps to description
    expect(result).toContain('Alice');
    expect(result).toContain('Engineer');
    expect(result).toContain('Performance');
  });

  it('renders a complete view with all fields populated', () => {
    const view = {
      title: 'Full Specification',
      id: 'full-spec-1',
      version: 2,
      businessGoal: 'Improve user retention by 20%',
      stakeholders: [{ name: 'Bob', role: 'CTO', interest: 'Technical feasibility' }],
      assumptions: [{ id: 'A1', description: 'Users have modern browsers' }],
      constraints: [{ id: 'C1', description: 'Must run on Node 22+' }],
      functionalRequirements: [{ id: 'FR-1', description: 'Login via OAuth', priority: 'High' }],
      nonFunctionalRequirements: [{ id: 'NFR-1', description: '99.9% uptime' }],
      acceptanceCriteria: [{ id: 'AC-1', description: 'All tests pass' }],
      risks: [
        { id: 'R1', description: 'Third-party API downtime', mitigation: 'Add circuit breaker' },
      ],
      definitionOfDone: ['Tests pass', 'Docs updated'],
      sources: [{ title: 'PRD', content: 'Product requirements document', type: 'document' }],
      analysis: {
        completenessScore: 0.75,
        assumptions: ['Stable network'],
        requirements: [{ id: 'REQ-A', priority: 'Medium', description: 'Handle offline' }],
        risks: ['Data loss risk'],
        ambiguities: ['Unclear deadline'],
        scopeBoundary: { inScope: ['Auth module'], outOfScope: ['Billing'] },
        technicalContext: { language: 'TypeScript' },
      },
    } as unknown as CanonicalSpecView;

    const result = renderCanonicalSpecification(view);

    // Title and metadata
    expect(result).toContain('# Full Specification');
    expect(result).toContain('**Id:** full-spec-1');
    expect(result).toContain('**Version:** 2');

    // Business goal
    expect(result).toContain('> Improve user retention by 20%');

    // Stakeholders
    expect(result).toContain('## Stakeholders');
    expect(result).toContain('Bob');
    expect(result).toContain('CTO');

    // Id-description sections
    expect(result).toContain('## Assumptions');
    expect(result).toContain('A1');
    expect(result).toContain('## Constraints');
    expect(result).toContain('C1');
    expect(result).toContain('## Functional Requirements');
    expect(result).toContain('FR-1');
    expect(result).toContain('_(High)_');
    expect(result).toContain('## Non-Functional Requirements');
    expect(result).toContain('NFR-1');
    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('AC-1');

    // Risks
    expect(result).toContain('## Risks');
    expect(result).toContain('**R1:** Third-party API downtime');
    expect(result).toContain('_Mitigation:_ Add circuit breaker');

    // Definition of Done
    expect(result).toContain('## Definition of Done');
    expect(result).toContain('- Tests pass');
    expect(result).toContain('- Docs updated');

    // Sources
    expect(result).toContain('## Sources');
    expect(result).toContain('**PRD:** Product requirements document');

    // Analysis
    expect(result).toContain('## Analysis');
    expect(result).toContain('**Completeness:** 75%');
    expect(result).toContain('### Assumptions');
    expect(result).toContain('- Stable network');
    expect(result).toContain('### Requirements');
    expect(result).toContain('REQ-A');
    expect(result).toContain('### Risks');
    expect(result).toContain('- Data loss risk');
    expect(result).toContain('### Ambiguities');
    expect(result).toContain('- Unclear deadline');
    expect(result).toContain('### Scope');
    expect(result).toContain('- Auth module');
    expect(result).toContain('- Billing');
    expect(result).toContain('### Technical Context');
    expect(result).toContain('**Language:** TypeScript');
  });

  it('separates sections with double newlines', () => {
    const view: CanonicalSpecView = {
      title: 'Sections Test',
      businessGoal: 'A goal',
      definitionOfDone: ['Done item'],
    };
    const result = renderCanonicalSpecification(view);
    const sections = result.split('\n\n');
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });

  it('does not duplicate metadata keys in remaining fields', () => {
    const view = {
      title: 'Spec',
      id: 'abc',
      version: 1,
    } as unknown as CanonicalSpecView;
    const result = renderCanonicalSpecification(view);
    // id and version should appear in metadata, not as extra rendered fields
    const occurrencesOfId = (result.match(/\*\*Id:\*\*/g) ?? []).length;
    expect(occurrencesOfId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renderAnalysisSection — branches not covered by artifact-renderers.test.ts
// ---------------------------------------------------------------------------
describe('renderAnalysisSection', () => {
  describe('ambiguities with question field', () => {
    it('renders ambiguity using question when description is missing', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ question: 'What is the deadline?' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('### Ambiguities');
      expect(result).toContain('- What is the deadline?');
    });

    it('renders ambiguity using question with impact', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ question: 'Which API version?', impact: 'Blocks integration' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- Which API version?');
      expect(result).toContain('_Impact:_ Blocks integration');
    });
  });

  describe('ambiguities with text field', () => {
    it('renders ambiguity using text when description and question are missing', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ text: 'Unclear requirement about caching' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('### Ambiguities');
      expect(result).toContain('- Unclear requirement about caching');
    });

    it('renders ambiguity using text with impact', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ text: 'Missing auth details', impact: 'Security concern' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- Missing auth details');
      expect(result).toContain('_Impact:_ Security concern');
    });
  });

  describe('ambiguities fallback to JSON.stringify', () => {
    it('falls back to JSON.stringify when no desc, question, or text is present', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ impact: 'High' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('### Ambiguities');
      expect(result).toContain('- {"impact":"High"}');
    });

    it('falls back to JSON.stringify for empty ambiguity object', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{}],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- {}');
    });
  });

  describe('ambiguities with description takes priority', () => {
    it('prefers description over question and text', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ description: 'Primary desc', question: 'Fallback q', text: 'Fallback t' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- Primary desc');
      expect(result).not.toContain('Fallback q');
      expect(result).not.toContain('Fallback t');
    });

    it('prefers question over text when description is missing', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [{ question: 'The question?', text: 'The text' }],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- The question?');
      expect(result).not.toContain('The text');
    });
  });

  describe('ambiguities mixed types', () => {
    it('handles a mix of strings and objects in one ambiguities array', () => {
      const analysis: SpecAnalysisSection = {
        ambiguities: [
          'Plain string ambiguity',
          { description: 'Object with desc', impact: 'Medium' },
          { question: 'Object with question?' },
          { text: 'Object with text' },
          { impact: 'Only impact, no desc' },
        ],
      };
      const result = renderAnalysisSection(analysis);
      expect(result).toContain('- Plain string ambiguity');
      expect(result).toContain('- Object with desc');
      expect(result).toContain('_Impact:_ Medium');
      expect(result).toContain('- Object with question?');
      expect(result).toContain('- Object with text');
      expect(result).toContain('- {"impact":"Only impact, no desc"}');
    });
  });

  describe('scopeBoundary that returns empty string', () => {
    it('does not render scope heading when both arrays are empty', () => {
      const analysis: SpecAnalysisSection = {
        scopeBoundary: { inScope: [], outOfScope: [] },
      };
      const result = renderAnalysisSection(analysis);
      expect(result).not.toContain('### Scope');
    });

    it('does not render scope heading when scopeBoundary has undefined arrays', () => {
      const analysis: SpecAnalysisSection = {
        scopeBoundary: {},
      };
      const result = renderAnalysisSection(analysis);
      expect(result).not.toContain('### Scope');
    });
  });

  describe('technicalContext edge cases', () => {
    it('does not render technical context heading when object is empty', () => {
      const analysis: SpecAnalysisSection = {
        technicalContext: {},
      };
      const result = renderAnalysisSection(analysis);
      expect(result).not.toContain('### Technical Context');
    });
  });

  describe('completenessScore rounding', () => {
    it('rounds completeness score to nearest integer', () => {
      const result = renderAnalysisSection({ completenessScore: 0.666 });
      expect(result).toContain('**Completeness:** 67%');
    });

    it('renders 100% for a score of 1', () => {
      const result = renderAnalysisSection({ completenessScore: 1 });
      expect(result).toContain('**Completeness:** 100%');
    });
  });
});

// ---------------------------------------------------------------------------
// CANONICAL_SPEC_SECTIONS — stakeholder edge cases
// ---------------------------------------------------------------------------
describe('CANONICAL_SPEC_SECTIONS stakeholder rendering', () => {
  const stakeholderEntry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'stakeholders');

  it('maps name to id, role to title, and interest to description', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [{ name: 'Carol', role: 'Lead', interest: 'Scalability' }],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toContain('## Stakeholders');
    expect(result).toContain('Carol');
    expect(result).toContain('Lead');
    expect(result).toContain('Scalability');
  });

  it('renders stakeholder with only name', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [{ name: 'Solo' }],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toContain('Solo');
  });

  it('renders stakeholder with only role', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [{ role: 'Architect' }],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toContain('Architect');
  });

  it('renders stakeholder with only interest', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [{ interest: 'Cost reduction' }],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toContain('Cost reduction');
  });

  it('renders stakeholder with empty fields using fallback label', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [{}],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toContain('## Stakeholders');
    // With no name/role/interest, the id+title are both undefined, label falls back to "Item"
    expect(result).toContain('**Item**');
  });

  it('returns undefined for empty stakeholders array', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      stakeholders: [],
    };
    const result = stakeholderEntry?.render(view);
    expect(result).toBeUndefined();
  });

  it('returns undefined when stakeholders is not defined', () => {
    const view: CanonicalSpecView = { title: 'T' };
    const result = stakeholderEntry?.render(view);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CANONICAL_SPEC_SECTIONS — idDescSection edge cases
// ---------------------------------------------------------------------------
describe('CANONICAL_SPEC_SECTIONS idDescSection entries', () => {
  const keys: Array<{
    key: string;
    heading: string;
  }> = [
    { key: 'assumptions', heading: 'Assumptions' },
    { key: 'constraints', heading: 'Constraints' },
    { key: 'functionalRequirements', heading: 'Functional Requirements' },
    { key: 'nonFunctionalRequirements', heading: 'Non-Functional Requirements' },
    { key: 'acceptanceCriteria', heading: 'Acceptance Criteria' },
  ];

  for (const { key, heading } of keys) {
    const entry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === key);

    it(`${key}: returns undefined for empty array`, () => {
      const view = { title: 'T', [key]: [] } as unknown as CanonicalSpecView;
      expect(entry?.render(view)).toBeUndefined();
    });

    it(`${key}: returns undefined when field is not defined`, () => {
      const view: CanonicalSpecView = { title: 'T' };
      expect(entry?.render(view)).toBeUndefined();
    });

    it(`${key}: renders items with heading`, () => {
      const view = {
        title: 'T',
        [key]: [{ id: 'X1', description: 'Item description' }],
      } as unknown as CanonicalSpecView;
      const result = entry?.render(view);
      expect(result).toContain(`## ${heading}`);
      expect(result).toContain('X1');
      expect(result).toContain('Item description');
    });
  }
});

// ---------------------------------------------------------------------------
// CANONICAL_SPEC_SECTIONS — sources section
// ---------------------------------------------------------------------------
describe('CANONICAL_SPEC_SECTIONS sources rendering', () => {
  const sourcesEntry = CANONICAL_SPEC_SECTIONS.find((e) => e.key === 'sources');

  it('renders sources with title and content', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      sources: [{ title: 'API Docs', content: 'REST API spec' }],
    };
    const result = sourcesEntry?.render(view);
    expect(result).toContain('## Sources');
    expect(result).toContain('**API Docs:** REST API spec');
  });

  it('renders multiple sources separated by double newlines', () => {
    const view: CanonicalSpecView = {
      title: 'T',
      sources: [
        { title: 'Source A', content: 'Content A' },
        { title: 'Source B', content: 'Content B' },
      ],
    };
    const result = sourcesEntry?.render(view);
    expect(result).toContain('**Source A:** Content A');
    expect(result).toContain('**Source B:** Content B');
  });

  it('returns undefined for empty sources array', () => {
    const view: CanonicalSpecView = { title: 'T', sources: [] };
    expect(sourcesEntry?.render(view)).toBeUndefined();
  });

  it('returns undefined when sources is not defined', () => {
    const view: CanonicalSpecView = { title: 'T' };
    expect(sourcesEntry?.render(view)).toBeUndefined();
  });
});
