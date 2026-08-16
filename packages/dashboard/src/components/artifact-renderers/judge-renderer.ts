import type { JudgeDecisionView } from './shared';
import {
  METADATA_KEYS,
  omitKeys,
  renderKeyValuePairs,
  renderMetadata,
  renderObject,
  toRaw,
} from './shared';

export function renderJudgeDecision(view: JudgeDecisionView): string {
  const raw = toRaw(view);
  const sections: string[] = [];

  const verdict = view.verdict ?? view.decision;
  const verdictSuffix = verdict ? `: ${verdict}` : '';
  sections.push(`# Judge Decision${verdictSuffix}`);

  const meta = renderMetadata(raw);
  if (meta) {
    sections.push(meta);
  }

  const reasoning = view.reasoning ?? view.rationale;
  if (reasoning) {
    sections.push(`## Reasoning\n\n${reasoning}`);
  }

  if (view.scores && Object.keys(view.scores).length > 0) {
    sections.push('## Scores\n', renderKeyValuePairs(view.scores));
  }

  if (view.conditions?.length) {
    sections.push('## Conditions\n', view.conditions.map((c) => `- ${c}`).join('\n'));
  }

  const remaining = omitKeys(raw, [
    'verdict',
    'decision',
    'reasoning',
    'rationale',
    'scores',
    'conditions',
    ...METADATA_KEYS,
  ]);
  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}
