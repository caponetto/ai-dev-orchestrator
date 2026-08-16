import { useEffect, useRef, useState } from 'react';

import type { DispatchGroup } from './use-agent-stream';

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

export interface PermissionNotificationsOptions {
  readonly enabled: boolean;
}

const DEFAULT_OPTIONS: PermissionNotificationsOptions = { enabled: true };

function isNotificationSupported(): boolean {
  return typeof globalThis.Notification === 'function';
}

export function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) {
    return Promise.resolve('denied');
  }
  return Notification.requestPermission();
}

export function getNotificationPermission(): NotificationPermissionState {
  if (!isNotificationSupported()) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Fires a browser notification whenever a new `permission_request` arrives
 * in the agent stream. Each request is deduplicated by its message ID so
 * the user is only notified once per request.
 *
 * On first mount, automatically prompts the user for browser notification
 * permission if it hasn't been requested yet.
 */
export function usePermissionNotifications(
  groups: ReadonlyMap<string, DispatchGroup>,
  options: PermissionNotificationsOptions = DEFAULT_OPTIONS,
): void {
  const notifiedRef = useRef<Set<string>>(new Set());
  const [permission, setPermission] =
    useState<NotificationPermissionState>(getNotificationPermission);

  useEffect(() => {
    if (!options.enabled || !isNotificationSupported()) {
      return;
    }
    if (Notification.permission !== 'default') {
      return;
    }
    void Notification.requestPermission().then((result) => {
      setPermission(result);
    });
  }, [options.enabled]);

  useEffect(() => {
    if (!options.enabled || !isNotificationSupported() || permission !== 'granted') {
      return;
    }

    for (const group of groups.values()) {
      for (const line of group.lines) {
        if (line.protocolMessage?.messageType !== 'permission_request') {
          continue;
        }

        const id = line.requestMessageId ?? `${line.dispatchId}:${line.timestamp}:${line.type}`;
        if (notifiedRef.current.has(id)) {
          continue;
        }
        notifiedRef.current.add(id);

        if (!document.hasFocus()) {
          const n = new Notification('Permission required', {
            body: `Agent "${group.roleId}" is waiting for your approval.`,
            tag: id,
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      }
    }
  }, [groups, options.enabled, permission]);
}
