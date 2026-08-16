import type { ResolvedArtifact } from '@ai-orchestrator/schemas';
import { hashContent } from '@ai-orchestrator/utils';

export interface ArtifactTrackingEntry {
  readonly kind: 'new' | 'unchanged' | 'changed';
  readonly iterationSeen?: number;
  readonly previousContent?: string;
}

interface StoredEntry {
  readonly contentHash: string;
  readonly content: string;
  readonly iteration: number;
}

export class SessionArtifactTracker {
  private readonly sessions = new Map<string, Map<string, StoredEntry>>();
  private readonly iterationCounters = new Map<string, number>();

  track(
    sessionKey: string,
    artifacts: readonly ResolvedArtifact[],
  ): Map<string, ArtifactTrackingEntry> {
    const currentIteration = (this.iterationCounters.get(sessionKey) ?? 0) + 1;
    this.iterationCounters.set(sessionKey, currentIteration);

    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, new Map());
    }
    const store = this.sessions.get(sessionKey) ?? new Map<string, StoredEntry>();
    const result = new Map<string, ArtifactTrackingEntry>();

    for (const artifact of artifacts) {
      const type = artifact.ref.type;
      const currentHash = hashContent(artifact.content);
      const previous = store.get(type);

      if (!previous) {
        result.set(type, { kind: 'new' });
      } else if (previous.contentHash === currentHash) {
        result.set(type, {
          kind: 'unchanged',
          iterationSeen: previous.iteration,
        });
      } else {
        result.set(type, {
          kind: 'changed',
          previousContent: previous.content,
        });
      }

      store.set(type, {
        contentHash: currentHash,
        content: artifact.content,
        iteration: currentIteration,
      });
    }

    return result;
  }
}
