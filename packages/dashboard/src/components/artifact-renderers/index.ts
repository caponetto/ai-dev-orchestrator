import type { ArtifactType } from '@ai-dev-orchestrator/schemas';

import { renderAgreement } from './agreement-renderer';
import { renderClarificationList } from './clarification-renderer';
import { renderJudgeDecision } from './judge-renderer';
import { renderReviewFindings } from './review-findings-renderer';
import { renderReviewReport } from './review-report-renderer';
import type { CanonicalSpecView, JsonObject, JsonValue } from './shared';
import { METADATA_KEYS, omitKeys, renderMetadata, renderObject } from './shared';
import { renderCanonicalSpecification } from './spec-renderer';

export type { CanonicalSpecSectionEntry } from './spec-renderer';
export { CANONICAL_SPEC_SECTIONS, renderAnalysisSection } from './spec-renderer';

const TYPE_RENDERERS: Readonly<
  Partial<Record<ArtifactType, (obj: JsonObject, runId?: string) => string>>
> = {
  canonical_specification: (obj) =>
    renderCanonicalSpecification(obj as unknown as CanonicalSpecView),
  judge_decision: (obj) => renderJudgeDecision(obj),
  clarification_questions: (obj) => renderClarificationList(obj),
  clarification_answers: (obj) => renderClarificationList(obj),
  planning_agreement: (obj) => renderAgreement(obj),
  implementation_agreement: (obj) => renderAgreement(obj),
  verification_agreement: (obj) => renderAgreement(obj),
  release_agreement: (obj) => renderAgreement(obj),
  review_findings: (obj) => renderReviewFindings(obj),
  review_report: (obj) => renderReviewReport(obj),
  static_review: (obj) => renderReviewReport(obj),
  security_review: (obj) => renderReviewReport(obj),
  performance_review: (obj) => renderReviewReport(obj),
  adversarial_review: (obj) => renderReviewReport(obj),
  design_review: (obj) => renderReviewReport(obj),
  docs_review: (obj) => renderReviewReport(obj),
  ux_review: (obj) => renderReviewReport(obj),
  plan_review: (obj) => renderReviewReport(obj),
};

function renderGeneric(obj: JsonObject): string {
  const sections: string[] = [];

  const title = (obj['title'] as string | undefined) ?? (obj['name'] as string | undefined);
  if (title) {
    sections.push(`# ${title}`);
  }

  const meta = renderMetadata(obj);
  if (meta) {
    sections.push(meta);
  }

  const skipKeys = title ? ['title', 'name', ...METADATA_KEYS] : [...METADATA_KEYS];
  const remaining = omitKeys(obj, skipKeys);

  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}

export function renderArtifactAsMarkdown(
  json: string,
  artifactType?: string,
  runId?: string,
): string {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(json) as JsonValue;
  } catch {
    return json;
  }

  if (parsed === null || typeof parsed !== 'object') {
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return '_No items_';
    }
    if (parsed.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
      return parsed
        .map((item, i) => {
          const obj = item as JsonObject;
          const title = (obj['title'] as string | undefined) ?? (obj['name'] as string | undefined);
          const heading = title ?? `Item ${String(i + 1)}`;
          return `## ${heading}\n\n${renderObject(omitKeys(obj, title ? ['title', 'name'] : []), 2)}`;
        })
        .join('\n\n---\n\n');
    }
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  }

  const obj = parsed;

  const resolvedType =
    artifactType ?? (typeof obj['__artifactType'] === 'string' ? obj['__artifactType'] : undefined);
  const cleaned = '__artifactType' in obj ? omitKeys(obj, ['__artifactType']) : obj;

  const renderer = resolvedType ? TYPE_RENDERERS[resolvedType as ArtifactType] : undefined;
  if (renderer) {
    return renderer(cleaned, runId);
  }

  return renderGeneric(cleaned);
}
