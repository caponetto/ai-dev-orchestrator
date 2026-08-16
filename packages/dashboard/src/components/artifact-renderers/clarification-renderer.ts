import type { ClarificationView } from './shared';
import { renderObject, toRaw } from './shared';

export function renderClarificationList(view: ClarificationView): string {
  const raw = toRaw(view);
  const sections: string[] = [];
  const items = view.questions ?? view.answers;

  const isAnswers = view.answers !== undefined;
  sections.push(`# Clarification ${isAnswers ? 'Answers' : 'Questions'}`);

  if (items?.length) {
    for (const item of items) {
      const q = item.question ?? item.text ?? '';
      sections.push(`**Q:** ${q}`);
      if (item.answer) {
        sections.push(`**A:** ${item.answer}`);
      }
    }
  } else {
    sections.push(renderObject(raw, 1));
  }

  return sections.join('\n\n');
}
