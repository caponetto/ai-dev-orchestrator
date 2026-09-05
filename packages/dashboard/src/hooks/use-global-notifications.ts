import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export interface GlobalNotificationsResult {
  readonly permission: NotificationPermissionState;
  readonly requestPermission: () => Promise<NotificationPermissionState>;
  readonly supported: boolean;
}

function isNotificationSupported(): boolean {
  return typeof globalThis.Notification === 'function';
}

function readPermission(): NotificationPermissionState {
  if (!isNotificationSupported()) {
    return 'denied';
  }
  return Notification.permission;
}

const COMPLETION_EVENT_TYPES = new Set(['run_completed', 'run_aborted']);
const ATTENTION_EVENT_TYPES = new Set(['permission_requested', 'clarification_requested']);

function shouldNotify(): boolean {
  return typeof document !== 'undefined' && !document.hasFocus();
}

/**
 * Global notification hook for AppShell. Fires browser notifications for
 * terminal run events and permission/clarification requests received on
 * the global SSE event stream, regardless of which page is active.
 *
 * Provides a `requestPermission` callback for user-gesture-triggered
 * permission prompts, avoiding silent auto-block by modern browsers.
 */
export function useGlobalNotifications(
  events: readonly DashboardEvent[],
): GlobalNotificationsResult {
  const [permission, setPermission] = useState<NotificationPermissionState>(readPermission);
  const notifiedRef = useRef<Set<string>>(new Set());
  const supported = isNotificationSupported();

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (!supported) {
      return 'denied';
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [supported]);

  useEffect(() => {
    if (!supported || permission !== 'granted') {
      return;
    }

    for (const event of events) {
      if (!event.runId) {
        continue;
      }
      if (COMPLETION_EVENT_TYPES.has(event.type)) {
        const id = `global:${event.runId}:${event.type}`;
        if (notifiedRef.current.has(id)) {
          continue;
        }
        notifiedRef.current.add(id);

        if (shouldNotify()) {
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
      } else if (ATTENTION_EVENT_TYPES.has(event.type)) {
        const messageId =
          typeof event.data?.['messageId'] === 'string' ? event.data['messageId'] : '';
        const id = `global:${event.runId}:${event.type}:${messageId}`;
        if (notifiedRef.current.has(id)) {
          continue;
        }
        notifiedRef.current.add(id);

        if (shouldNotify()) {
          const kind =
            event.type === 'permission_requested' ? 'Permission required' : 'Input needed';
          const n = new Notification(kind, {
            body: `Run ${event.runId} is waiting for your attention.`,
            tag: id,
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      }
    }
  }, [events, permission, supported]);

  return { permission, requestPermission, supported };
}
