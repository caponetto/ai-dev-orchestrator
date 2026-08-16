import { describe, expect, it } from 'vitest';

import { renderClarificationList } from '../clarification-renderer';
import type { ClarificationItem, ClarificationView } from '../shared';

describe('renderClarificationList', () => {
  describe('heading', () => {
    it('renders "Clarification Questions" when only questions present', () => {
      const view: ClarificationView = {
        questions: [{ question: 'What is the scope?' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Questions');
    });

    it('renders "Clarification Answers" when only answers present', () => {
      const view: ClarificationView = {
        answers: [{ question: 'What is the scope?', answer: 'Full project' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Answers');
    });

    it('renders "Clarification Answers" when both questions and answers present', () => {
      const view: ClarificationView = {
        questions: [{ question: 'Q1' }],
        answers: [{ question: 'Q2', answer: 'A2' }],
      };
      const result = renderClarificationList(view);
      // isAnswers = true because answers !== undefined
      expect(result).toContain('# Clarification Answers');
    });

    it('renders "Clarification Questions" when neither questions nor answers present', () => {
      const view: ClarificationView = {};
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Questions');
    });
  });

  describe('item selection (questions ?? answers)', () => {
    it('uses questions when both are present', () => {
      const view: ClarificationView = {
        questions: [{ question: 'From questions' }],
        answers: [{ question: 'From answers', answer: 'A' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** From questions');
      expect(result).not.toContain('From answers');
    });

    it('uses answers when questions is absent', () => {
      const view: ClarificationView = {
        answers: [{ question: 'From answers', answer: 'A' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** From answers');
      expect(result).toContain('**A:** A');
    });
  });

  describe('item rendering', () => {
    it('uses question field for Q text', () => {
      const view: ClarificationView = {
        questions: [{ question: 'How does it work?' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** How does it work?');
    });

    it('falls back to text field when question is absent', () => {
      const view: ClarificationView = {
        questions: [{ text: 'Alternative text' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** Alternative text');
    });

    it('uses empty string when neither question nor text is present', () => {
      const view: ClarificationView = {
        questions: [{ answer: 'Only answer' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** ');
    });

    it('renders answer when present', () => {
      const view: ClarificationView = {
        answers: [{ question: 'Q', answer: 'The answer is 42' }],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('**A:** The answer is 42');
    });

    it('omits answer section when answer is absent', () => {
      const view: ClarificationView = {
        questions: [{ question: 'No answer here' }],
      };
      const result = renderClarificationList(view);
      expect(result).not.toContain('**A:**');
    });

    it('omits answer section when answer is empty string', () => {
      const view: ClarificationView = {
        questions: [{ question: 'Q', answer: '' }],
      };
      const result = renderClarificationList(view);
      expect(result).not.toContain('**A:**');
    });

    it('renders multiple items', () => {
      const items: ClarificationItem[] = [
        { question: 'First?', answer: 'Yes' },
        { question: 'Second?', answer: 'No' },
        { text: 'Third?' },
      ];
      const view: ClarificationView = { questions: items };
      const result = renderClarificationList(view);
      expect(result).toContain('**Q:** First?');
      expect(result).toContain('**A:** Yes');
      expect(result).toContain('**Q:** Second?');
      expect(result).toContain('**A:** No');
      expect(result).toContain('**Q:** Third?');
    });
  });

  describe('fallback to renderObject', () => {
    it('falls back to renderObject when items is undefined (no questions or answers)', () => {
      const view = { context: 'some context' } as unknown as ClarificationView;
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Questions');
      expect(result).toContain('Context');
      expect(result).toContain('some context');
    });

    it('falls back to renderObject when questions array is empty', () => {
      const view: ClarificationView = { questions: [] };
      const result = renderClarificationList(view);
      // items?.length is falsy for empty array, so falls back
      expect(result).toContain('# Clarification Questions');
    });

    it('falls back to renderObject when answers array is empty', () => {
      const view: ClarificationView = { answers: [] };
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Answers');
    });
  });

  describe('full integration', () => {
    it('renders a complete Q&A list', () => {
      const view: ClarificationView = {
        answers: [
          { question: 'What framework?', answer: 'React' },
          { text: 'What language?', answer: 'TypeScript' },
          { question: 'Deadline?', answer: '' },
        ],
      };
      const result = renderClarificationList(view);
      expect(result).toContain('# Clarification Answers');
      expect(result).toContain('**Q:** What framework?');
      expect(result).toContain('**A:** React');
      expect(result).toContain('**Q:** What language?');
      expect(result).toContain('**A:** TypeScript');
      expect(result).toContain('**Q:** Deadline?');
      // Empty answer string is falsy, so no A section for it
      const aCount = (result.match(/\*\*A:\*\*/g) ?? []).length;
      expect(aCount).toBe(2);
    });

    it('sections are separated by double newlines', () => {
      const view: ClarificationView = {
        questions: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2' }],
      };
      const result = renderClarificationList(view);
      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });
  });
});
