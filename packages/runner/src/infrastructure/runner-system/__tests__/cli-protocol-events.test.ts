import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import { describe, expect, it, vi } from 'vitest';

import { handleCliArtifact, handleCliLog, handleCliProgress } from '../cli-protocol-events';

describe('CLI protocol event mapping', () => {
  it('preserves progress metadata and routes warnings to stderr', () => {
    const stream = vi.fn();
    handleCliProgress(
      createProtocolMessage('progress', { phase: 'planning', detail: 'Working', percent: 50 }),
      stream,
    );
    handleCliLog(createProtocolMessage('log', { level: 'warn', message: 'Check output' }), stream);
    expect(stream).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'status', content: 'Working (50%)' }),
    );
    expect(stream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'stderr', content: '[warn] Check output' }),
    );
  });

  it('keeps the first interim artifact until a final artifact replaces it', () => {
    const interim = createProtocolMessage('artifact', {
      artifactType: 'plan',
      content: 'first',
      isFinal: false,
    });
    expect(handleCliArtifact(interim, undefined)).toBe('first');
    expect(handleCliArtifact(interim, 'existing')).toBe('existing');
    expect(
      handleCliArtifact(
        createProtocolMessage('artifact', {
          artifactType: 'plan',
          content: 'final',
          isFinal: true,
        }),
        'existing',
      ),
    ).toBe('final');
  });
});
