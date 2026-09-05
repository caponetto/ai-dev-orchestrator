// @vitest-environment jsdom
import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalNotifications } from '../use-global-notifications';

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

function makeEvent(
  type: string,
  runId = 'run-1',
  data: Record<string, unknown> = {},
): DashboardEvent {
  return { type, timestamp: '2026-08-03T12:00:00Z', runId, data } as DashboardEvent;
}

describe('useGlobalNotifications', () => {
  beforeEach(() => {
    MockNotification.reset();
    vi.stubGlobal('Notification', MockNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('completion notifications', () => {
    it('fires a notification on run_completed', () => {
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('Workflow completed');
      expect(MockNotification.instances[0].options.body).toBe('Run run-1 has completed.');
    });

    it('fires a notification on run_aborted', () => {
      const events = [makeEvent('run_aborted')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('Workflow aborted');
      expect(MockNotification.instances[0].options.body).toBe('Run run-1 has aborted.');
    });

    it('deduplicates by run ID and event type', () => {
      const events = [makeEvent('run_completed'), makeEvent('run_completed')];

      const { rerender } = renderHook(({ e }) => useGlobalNotifications(e), {
        initialProps: { e: events },
      });

      expect(MockNotification.instances).toHaveLength(1);

      rerender({ e: [...events, makeEvent('run_completed')] });
      expect(MockNotification.instances).toHaveLength(1);
    });

    it('fires separate notifications for different runs', () => {
      const events = [makeEvent('run_completed', 'run-1'), makeEvent('run_completed', 'run-2')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(2);
    });

    it('ignores non-terminal events', () => {
      const events = [
        makeEvent('state_changed'),
        makeEvent('worker_dispatched'),
        makeEvent('artifact_produced'),
      ];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(0);
    });
  });

  describe('attention notifications', () => {
    it('fires a notification on permission_requested', () => {
      const events = [makeEvent('permission_requested', 'run-1', { messageId: 'msg-1' })];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('Permission required');
      expect(MockNotification.instances[0].options.body).toBe(
        'Run run-1 is waiting for your attention.',
      );
    });

    it('fires a notification on clarification_requested', () => {
      const events = [makeEvent('clarification_requested', 'run-1', { messageId: 'msg-2' })];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
      expect(MockNotification.instances[0].title).toBe('Input needed');
    });

    it('deduplicates attention events by runId, type, and messageId', () => {
      const events = [
        makeEvent('permission_requested', 'run-1', { messageId: 'msg-1' }),
        makeEvent('permission_requested', 'run-1', { messageId: 'msg-1' }),
      ];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('fires separate notifications for different messageIds', () => {
      const events = [
        makeEvent('permission_requested', 'run-1', { messageId: 'msg-1' }),
        makeEvent('permission_requested', 'run-1', { messageId: 'msg-2' }),
      ];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(2);
    });
  });

  describe('permission management', () => {
    it('returns current permission state', () => {
      MockNotification.permission = 'granted';

      const { result } = renderHook(() => useGlobalNotifications([]));

      expect(result.current.permission).toBe('granted');
      expect(result.current.supported).toBe(true);
    });

    it('requestPermission calls Notification.requestPermission and updates state', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission.mockResolvedValue('granted');

      const { result } = renderHook(() => useGlobalNotifications([]));
      expect(result.current.permission).toBe('default');

      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.requestPermission();
      });

      expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
      expect(outcome).toBe('granted');
      expect(result.current.permission).toBe('granted');
    });

    it('does not fire notifications when permission is not granted', () => {
      MockNotification.permission = 'default';
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('does not fire notifications when permission is denied', () => {
      MockNotification.permission = 'denied';
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('fires notifications after permission is granted via requestPermission', async () => {
      MockNotification.permission = 'default';
      MockNotification.requestPermission.mockResolvedValue('granted');
      const events = [makeEvent('run_completed')];

      const { result, rerender } = renderHook(({ e }) => useGlobalNotifications(e), {
        initialProps: { e: events },
      });

      expect(MockNotification.instances).toHaveLength(0);

      await act(async () => {
        await result.current.requestPermission();
      });

      rerender({ e: events });

      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  describe('focus gating', () => {
    it('does not fire when the document has focus', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('fires when the document does not have focus', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  describe('click handling', () => {
    it('focuses the tab and closes the notification on click', () => {
      const windowFocusSpy = vi.spyOn(globalThis, 'focus').mockImplementation(() => undefined);
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(1);
      const notification = MockNotification.instances[0];
      expect(notification.onclick).toBeTypeOf('function');

      notification.onclick?.(new Event('click'));

      expect(windowFocusSpy).toHaveBeenCalledOnce();
      expect(notification.close).toHaveBeenCalledOnce();

      windowFocusSpy.mockRestore();
    });
  });

  describe('unsupported environment', () => {
    it('returns denied and unsupported when Notification API is unavailable', () => {
      vi.stubGlobal('Notification', undefined);

      const { result } = renderHook(() => useGlobalNotifications([]));

      expect(result.current.supported).toBe(false);
      expect(result.current.permission).toBe('denied');
    });

    it('requestPermission returns denied when unsupported', async () => {
      vi.stubGlobal('Notification', undefined);

      const { result } = renderHook(() => useGlobalNotifications([]));

      let outcome: string | undefined;
      await act(async () => {
        outcome = await result.current.requestPermission();
      });

      expect(outcome).toBe('denied');
    });

    it('does not fire notifications when unsupported', () => {
      vi.stubGlobal('Notification', undefined);
      const events = [makeEvent('run_completed')];

      renderHook(() => useGlobalNotifications(events));

      expect(MockNotification.instances).toHaveLength(0);
    });
  });
});
