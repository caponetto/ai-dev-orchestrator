import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { useEffect, useRef } from 'react';

import { getNotificationPermission } from './use-permission-notifications';

export interface CompletionNotificationsOptions {
  readonly enabled: boolean;
}

const DEFAULT_OPTIONS: CompletionNotificationsOptions = { enabled: true };

const TERMINAL_EVENT_TYPES = new Set(['run_completed', 'run_aborted']);

function isNotificationSupported(): boolean {
  return typeof globalThis.Notification === 'function';
}

/**
 * Fires a browser notification when the workflow reaches a terminal state
 * (`run_completed` or `run_aborted`). Deduplicated by run ID so the user
 * is notified at most once per run.
 */
export function useCompletionNotifications(
  events: readonly DashboardEvent[],
  options: CompletionNotificationsOptions = DEFAULT_OPTIONS,
): void {
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      !options.enabled ||
      !isNotificationSupported() ||
      getNotificationPermission() !== 'granted'
    ) {
      return;
    }

    for (const event of events) {
      if (!TERMINAL_EVENT_TYPES.has(event.type)) {
        continue;
      }
      if (!event.runId) {
        continue;
      }

      const id = `${event.runId}:${event.type}`;
      if (notifiedRef.current.has(id)) {
        continue;
      }
      notifiedRef.current.add(id);

      if (!document.hasFocus()) {
        const status = event.type === 'run_completed' ? 'completed' : 'aborted';
        const n = new Notification(`Workflow ${status}`, {
          body: `Run ${event.runId} has ${status}.`,
          tag: id,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    }
  }, [events, options.enabled]);
}
