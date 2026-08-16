import type { AgentSessionSnapshot, SessionPendingRequest } from '@ai-orchestrator/schemas';

import type { AgentSessionRegistry } from './agent-session-registry';
import type { LiveRequestStore } from './file-backed-live-request-store';

/** Result of resolving a request through the router. */
type RequestRouteResult =
  | {
      readonly kind: 'session';
      readonly sessionId: string;
      readonly request: SessionPendingRequest;
    }
  | {
      readonly kind: 'legacy';
    }
  | {
      readonly kind: 'not_found';
    }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly AgentSessionSnapshot[];
    };

/**
 * Routes incoming human responses (from CLI / dashboard) to the correct
 * session or falls back to the legacy LiveRequestStore.
 *
 * This is the compatibility bridge that prevents the old file-backed
 * live-request path and the new session store from being independent
 * sources of truth.
 */
export class AgentSessionRequestRouter {
  private readonly registry: AgentSessionRegistry;
  private readonly legacyStore?: LiveRequestStore;

  constructor(registry: AgentSessionRegistry, legacyStore?: LiveRequestStore) {
    this.registry = registry;
    this.legacyStore = legacyStore;
  }

  /**
   * Resolve a request by runId and optional messageId/sessionId.
   *
   * Resolution order:
   * 1. If sessionId is provided, look up directly in the registry.
   * 2. If messageId is provided, search active sessions for a matching pending request.
   * 3. If exactly one active session has a pending request, return it (convenience routing).
   * 4. If multiple sessions have pending requests, return ambiguous.
   * 5. Fall back to the legacy LiveRequestStore.
   */
  resolve(runId: string, opts?: { sessionId?: string; messageId?: string }): RequestRouteResult {
    if (opts?.sessionId) {
      const snap = this.registry.get(opts.sessionId);
      if (!snap || snap.ref.runId !== runId) {
        return { kind: 'not_found' };
      }
      const pending = opts.messageId
        ? snap.pendingRequests.find((r) => r.requestId === opts.messageId)
        : snap.pendingRequests[0];
      if (!pending) {
        return { kind: 'not_found' };
      }
      return { kind: 'session', sessionId: snap.ref.sessionId, request: pending };
    }

    const activeSessions = this.registry.listActiveByRun(runId);
    const withPending = activeSessions.filter((s) => s.pendingRequests.length > 0);

    if (opts?.messageId) {
      for (const snap of withPending) {
        const match = snap.pendingRequests.find((r) => r.requestId === opts.messageId);
        if (match) {
          return { kind: 'session', sessionId: snap.ref.sessionId, request: match };
        }
      }
      if (this.legacyStore) {
        return { kind: 'legacy' };
      }
      return { kind: 'not_found' };
    }

    if (withPending.length === 1) {
      const snap = withPending[0];
      const pending = snap.pendingRequests[0];
      return { kind: 'session', sessionId: snap.ref.sessionId, request: pending };
    }

    if (withPending.length > 1) {
      return { kind: 'ambiguous', candidates: withPending };
    }

    if (this.legacyStore) {
      return { kind: 'legacy' };
    }

    return { kind: 'not_found' };
  }
}
