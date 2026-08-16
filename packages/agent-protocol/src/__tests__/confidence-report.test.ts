import { describe, expect, it } from 'vitest';

import type { DonePayload } from '../agent-protocol-types';
import { createProtocolMessage } from '../agent-protocol-types';

describe('DonePayload with confidence', () => {
  it('accepts a done message without confidence (backward compat)', () => {
    const msg = createProtocolMessage('done', { summary: 'Task completed' });
    expect(msg.payload.summary).toBe('Task completed');
    expect((msg.payload as DonePayload).confidence).toBeUndefined();
  });

  it('accepts a done message with confidence report', () => {
    const payload: DonePayload = {
      summary: 'Task completed',
      confidence: {
        score: 0.85,
        criteriaResults: [{ criterionId: 'sc-1', met: true, evidence: 'Test passes' }],
        rationale: 'All criteria met',
      },
    };
    const msg = createProtocolMessage('done', payload);
    expect(msg.payload.confidence?.score).toBe(0.85);
    expect(msg.payload.confidence?.criteriaResults).toHaveLength(1);
  });
});
