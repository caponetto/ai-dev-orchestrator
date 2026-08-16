// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardAgentStreamEvent, DispatchGroup } from '../use-agent-stream';
import {
  getNotificationPermission,
  requestNotificationPermission,
  usePermissionNotifications,
} from '../use-permission-notifications';

function makeEvent(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'state-1',
    roleId: 'implementer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-07-21T12:00:00Z',
    type: 'stdout',
    content: '',
    ...overrides,
  };
}

function makePermissionEvent(
  opts: { messageId?: string; action?: string; resource?: string; dispatchId?: string } = {},
): DashboardAgentStreamEvent {
  return makeEvent({
    dispatchId: opts.dispatchId ?? 'dispatch-1',
    requestMessageId: opts.messageId ?? 'msg-1',
    protocolMessage: {
      messageType: 'permission_request',
      payload: {
        action: opts.action ?? 'file_write',
        resource: opts.resource ?? '/src/main.ts',
      },
    },
  });
}

function makeGroups(...entries: [string, DispatchGroup][]): Map<string, DispatchGroup> {
  return new Map(entries);
}

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn().mockResolvedValue('granted');

  readonly title: string;
  readonly options: NotificationOptions;
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options ?? {};
    MockNotification.instances.push(this);
  }

  static instances: MockNotification[] = [];
  static reset() {
    MockNotification.instances = [];
    MockNotification.permission = 'granted';
    MockNotification.requestPermission.mockReset().mockResolvedValue('granted');
  }
}

describe('usePermissionNotifications', () => {
  beforeEach(() => {
    MockNotification.reset();
    vi.stubGlobal('Notification', MockNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fires a notification for a permission_request event', () => {
    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('Permission required');
    expect(MockNotification.instances[0].options.body).toBe(
      'Agent "implementer" is waiting for your approval.',
    );
    expect(MockNotification.instances[0].options.tag).toBe('msg-1');
  });

  it('focuses the tab and closes the notification on click', () => {
    const windowFocusSpy = vi.spyOn(globalThis, 'focus').mockImplementation(() => undefined);

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(1);
    const notification = MockNotification.instances[0];
    expect(notification.onclick).toBeTypeOf('function');

    notification.onclick?.(new Event('click'));

    expect(windowFocusSpy).toHaveBeenCalledOnce();
    expect(notification.close).toHaveBeenCalledOnce();

    windowFocusSpy.mockRestore();
  });

  it('deduplicates notifications for the same request', () => {
    const event = makePermissionEvent({ messageId: 'msg-dup' });
    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [event],
      },
    ]);

    const { rerender } = renderHook(
      ({ g }) => {
        usePermissionNotifications(g);
      },
      { initialProps: { g: groups } },
    );

    expect(MockNotification.instances).toHaveLength(1);

    const updatedGroups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [event, makeEvent()],
      },
    ]);
    rerender({ g: updatedGroups });

    expect(MockNotification.instances).toHaveLength(1);
  });

  it('fires separate notifications for different requests', () => {
    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'verifier',
        stateId: 'state-1',
        lines: [
          makePermissionEvent({ messageId: 'msg-a', action: 'shell_execute' }),
          makePermissionEvent({ messageId: 'msg-b', action: 'file_write' }),
        ],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(2);
    expect(MockNotification.instances[0].options.tag).toBe('msg-a');
    expect(MockNotification.instances[1].options.tag).toBe('msg-b');
  });

  it('does nothing when disabled via options', () => {
    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups, { enabled: false });
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does not fire notifications when permission is denied', () => {
    MockNotification.permission = 'denied';
    MockNotification.requestPermission.mockResolvedValue('denied');

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('auto-prompts for permission on mount when permission is default', () => {
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockResolvedValue('granted');

    renderHook(() => {
      usePermissionNotifications(new Map());
    });

    expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
  });

  it('does not prompt when permission is already granted', () => {
    MockNotification.permission = 'granted';

    renderHook(() => {
      usePermissionNotifications(new Map());
    });

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('does not prompt when permission is already denied', () => {
    MockNotification.permission = 'denied';

    renderHook(() => {
      usePermissionNotifications(new Map());
    });

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('fires notifications after auto-prompt is granted', async () => {
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockResolvedValue('granted');

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    const { rerender } = renderHook(
      ({ g }) => {
        usePermissionNotifications(g);
      },
      { initialProps: { g: groups } },
    );

    expect(MockNotification.instances).toHaveLength(0);

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ g: groups });

    expect(MockNotification.instances).toHaveLength(1);
  });

  it('does nothing when Notification API is unavailable', () => {
    vi.stubGlobal('Notification', undefined);

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });
  });

  it('ignores non-permission events', () => {
    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [
          makeEvent({ protocolMessage: { messageType: 'progress', payload: {} } }),
          makeEvent({ protocolMessage: { messageType: 'log', payload: {} } }),
          makeEvent(),
        ],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('builds a fallback ID when requestMessageId is missing', () => {
    const event = makePermissionEvent();
    const noMessageId: DashboardAgentStreamEvent = {
      ...event,
      requestMessageId: undefined,
    };

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [noMessageId],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].options.tag).toBe(
      `dispatch-1:${noMessageId.timestamp}:${noMessageId.type}`,
    );
  });

  it('handles empty groups gracefully', () => {
    const groups = new Map<string, DispatchGroup>();

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does not fire a notification when the document has focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    const groups = makeGroups([
      'dispatch-1',
      {
        dispatchId: 'dispatch-1',
        roleId: 'implementer',
        stateId: 'state-1',
        lines: [makePermissionEvent()],
      },
    ]);

    renderHook(() => {
      usePermissionNotifications(groups);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });
});

describe('requestNotificationPermission', () => {
  beforeEach(() => {
    MockNotification.reset();
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls Notification.requestPermission and returns the result', async () => {
    MockNotification.requestPermission.mockResolvedValue('granted');

    const result = await requestNotificationPermission();

    expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
    expect(result).toBe('granted');
  });

  it('returns denied when Notification API is unavailable', async () => {
    vi.stubGlobal('Notification', undefined);

    const result = await requestNotificationPermission();

    expect(result).toBe('denied');
  });
});

describe('getNotificationPermission', () => {
  beforeEach(() => {
    MockNotification.reset();
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns current Notification.permission', () => {
    MockNotification.permission = 'granted';

    expect(getNotificationPermission()).toBe('granted');
  });

  it('returns denied when Notification API is unavailable', () => {
    vi.stubGlobal('Notification', undefined);

    expect(getNotificationPermission()).toBe('denied');
  });
});
