import type { CanonicalSpecView, SourceEntry, SpecAnalysisSection } from './shared';
import {
  METADATA_KEYS,
  omitKeys,
  renderIdDescriptionList,
  renderKeyValuePairs,
  renderMetadata,
  renderObject,
  renderRequirementsTable,
  renderRisks,
  renderScopeBoundary,
  renderSourceEntry,
  toRaw,
} from './shared';

export interface CanonicalSpecSectionEntry {
  key: string;
  render: (view: CanonicalSpecView) => string | undefined;
}

type SpecIdDescKey =
  | 'assumptions'
  | 'constraints'
  | 'functionalRequirements'
  | 'nonFunctionalRequirements'
  | 'acceptanceCriteria';

function idDescSection(key: SpecIdDescKey, heading: string): CanonicalSpecSectionEntry {
  return {
    key,
    render: (view) => {
      const items = view[key];
      if (items?.length) {
        return renderIdDescriptionList(items, heading);
      }
      return undefined;
    },
  };
}

export const CANONICAL_SPEC_SECTIONS: readonly CanonicalSpecSectionEntry[] = [
  {
    key: 'businessGoal',
    render: (view) => (view.businessGoal ? `> ${view.businessGoal}` : undefined),
  },
  {
    key: 'stakeholders',
    render: (view) =>
      view.stakeholders?.length
        ? renderIdDescriptionList(
            view.stakeholders.map((s) => ({
              id: s.name,
              title: s.role,
              description: s.interest,
            })),
            'Stakeholders',
          )
        : undefined,
  },
  idDescSection('assumptions', 'Assumptions'),
  idDescSection('constraints', 'Constraints'),
  idDescSection('functionalRequirements', 'Functional Requirements'),
  idDescSection('nonFunctionalRequirements', 'Non-Functional Requirements'),
  idDescSection('acceptanceCriteria', 'Acceptance Criteria'),
  {
    key: 'risks',
    render: (view) =>
      view.risks?.length ? '## Risks\n' + '\n\n' + renderRisks(view.risks) : undefined,
  },
  {
    key: 'definitionOfDone',
    render: (view) =>
      view.definitionOfDone?.length
        ? '## Definition of Done\n\n' + view.definitionOfDone.map((d) => `- ${d}`).join('\n')
        : undefined,
  },
  {
    key: 'sources',
    render: (view) =>
      view.sources?.length
        ? '## Sources\n\n' +
          (view.sources as unknown as SourceEntry[]).map(renderSourceEntry).join('\n\n')
        : undefined,
  },
];

export function renderAnalysisSection(analysis: SpecAnalysisSection): string {
  const parts: string[] = [];

  if (analysis.completenessScore !== undefined) {
    parts.push(
      `## Analysis\n\n**Completeness:** ${String(Math.round(analysis.completenessScore * 100))}%`,
    );
  }

  if (analysis.assumptions?.length) {
    parts.push('### Assumptions\n', analysis.assumptions.map((a) => `- ${a}`).join('\n'));
  }

  if (analysis.requirements?.length) {
    parts.push('### Requirements\n', renderRequirementsTable(analysis.requirements));
  }

  if (analysis.risks?.length) {
    parts.push('### Risks\n', renderRisks(analysis.risks));
  }

  if (analysis.ambiguities?.length) {
    parts.push(
      '### Ambiguities\n',
      analysis.ambiguities
        .map((a) => {
          if (typeof a === 'string') {
            return `- ${a}`;
          }
          const desc = a.description ?? a.question ?? a.text;
          if (desc) {
            return a.impact ? `- ${desc}\n  - _Impact:_ ${a.impact}` : `- ${desc}`;
          }
          return `- ${JSON.stringify(a)}`;
        })
        .join('\n'),
    );
  }

  if (analysis.scopeBoundary) {
    const scopeContent = renderScopeBoundary(analysis.scopeBoundary);
    if (scopeContent) {
      parts.push('### Scope\n', scopeContent);
    }
  }

  if (analysis.technicalContext && Object.keys(analysis.technicalContext).length > 0) {
    parts.push('### Technical Context\n', renderKeyValuePairs(analysis.technicalContext));
  }

  return parts.join('\n\n');
}

export function renderCanonicalSpecification(view: CanonicalSpecView): string {
  const raw = toRaw(view);
  const sections: string[] = [];
  const handled = new Set<string>(METADATA_KEYS);

  const title = view.title;
  sections.push(`# ${title}`);
  handled.add('title');

  const meta = renderMetadata(raw);
  if (meta) {
    sections.push(meta);
  }

  for (const entry of CANONICAL_SPEC_SECTIONS) {
    const content = entry.render(view);
    if (content !== undefined) {
      sections.push(content);
      handled.add(entry.key);
    }
  }

  if (view.analysis) {
    handled.add('analysis');
    const analysisContent = renderAnalysisSection(view.analysis);
    if (analysisContent) {
      sections.push(analysisContent);
    }
  }

  const remaining = omitKeys(raw, handled);
  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}
