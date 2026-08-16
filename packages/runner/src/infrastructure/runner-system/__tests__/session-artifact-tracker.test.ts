import type { ResolvedArtifact } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { SessionArtifactTracker } from '../session-artifact-tracker';

function makeArtifact(type: string, content: string, version = 1): ResolvedArtifact {
  return {
    ref: { type, name: `${type}-output`, version, checksum: 'hash' },
    content,
  };
}

describe('SessionArtifactTracker', () => {
  it('marks all artifacts as new on first call', () => {
    const tracker = new SessionArtifactTracker();
    const artifacts = [makeArtifact('implementation', 'code here')];

    const result = tracker.track('session-1', artifacts);

    expect(result.get('implementation')?.kind).toBe('new');
  });

  it('marks unchanged artifacts on second call with same content', () => {
    const tracker = new SessionArtifactTracker();
    const artifacts = [makeArtifact('implementation', 'code here')];

    tracker.track('session-1', artifacts);
    const result = tracker.track('session-1', artifacts);

    expect(result.get('implementation')?.kind).toBe('unchanged');
    expect(result.get('implementation')?.iterationSeen).toBe(1);
  });

  it('marks changed artifacts when content differs', () => {
    const tracker = new SessionArtifactTracker();

    tracker.track('session-1', [makeArtifact('implementation', 'old code')]);
    const result = tracker.track('session-1', [makeArtifact('implementation', 'new code')]);

    expect(result.get('implementation')?.kind).toBe('changed');
    expect(result.get('implementation')?.previousContent).toBe('old code');
  });

  it('isolates tracking between different session keys', () => {
    const tracker = new SessionArtifactTracker();
    const artifacts = [makeArtifact('implementation', 'code')];

    tracker.track('session-1', artifacts);
    const result = tracker.track('session-2', artifacts);

    expect(result.get('implementation')?.kind).toBe('new');
  });

  it('tracks multiple artifact types independently', () => {
    const tracker = new SessionArtifactTracker();

    tracker.track('session-1', [
      makeArtifact('implementation', 'code v1'),
      makeArtifact('plan', 'plan v1'),
    ]);

    const result = tracker.track('session-1', [
      makeArtifact('implementation', 'code v2'),
      makeArtifact('plan', 'plan v1'),
    ]);

    expect(result.get('implementation')?.kind).toBe('changed');
    expect(result.get('plan')?.kind).toBe('unchanged');
  });

  it('increments iteration counter per session', () => {
    const tracker = new SessionArtifactTracker();
    const artifacts = [makeArtifact('implementation', 'code')];

    tracker.track('session-1', artifacts);
    tracker.track('session-1', artifacts);
    const result = tracker.track('session-1', [makeArtifact('implementation', 'updated')]);

    expect(result.get('implementation')?.kind).toBe('changed');
  });
});
