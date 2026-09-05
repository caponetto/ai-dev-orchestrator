// @vitest-environment jsdom
import type { DashboardEvent } from '@ai-dev-orchestrator/schemas';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompletionNotifications } from '../use-completion-notifications';

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

function makeEvent(type: string, runId = 'run-1'): DashboardEvent {
  return { type, timestamp: '2026-07-24T12:00:00Z', runId, data: {} } as DashboardEvent;
}

describe('useCompletionNotifications', () => {
  beforeEach(() => {
    MockNotification.reset();
    vi.stubGlobal('Notification', MockNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fires a notification on run_completed', () => {
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('Workflow completed');
    expect(MockNotification.instances[0].options.body).toBe('Run run-1 has completed.');
    expect(MockNotification.instances[0].options.tag).toBe('run-1:run_completed');
  });

  it('fires a notification on run_aborted', () => {
    const events = [makeEvent('run_aborted')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('Workflow aborted');
    expect(MockNotification.instances[0].options.body).toBe('Run run-1 has aborted.');
  });

  it('deduplicates by run ID and event type', () => {
    const events = [makeEvent('run_completed'), makeEvent('run_completed')];

    const { rerender } = renderHook(
      ({ e }) => {
        useCompletionNotifications(e);
      },
      { initialProps: { e: events } },
    );

    expect(MockNotification.instances).toHaveLength(1);

    rerender({ e: [...events, makeEvent('run_completed')] });
    expect(MockNotification.instances).toHaveLength(1);
  });

  it('fires separate notifications for different runs', () => {
    const events = [makeEvent('run_completed', 'run-1'), makeEvent('run_completed', 'run-2')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(2);
    expect(MockNotification.instances[0].options.tag).toBe('run-1:run_completed');
    expect(MockNotification.instances[1].options.tag).toBe('run-2:run_completed');
  });

  it('ignores non-terminal events', () => {
    const events = [
      makeEvent('state_changed'),
      makeEvent('worker_dispatched'),
      makeEvent('artifact_produced'),
    ];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does nothing when disabled', () => {
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events, { enabled: false });
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does nothing when permission is denied', () => {
    MockNotification.permission = 'denied';
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does not fire when the document has focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('focuses the tab and closes the notification on click', () => {
    const windowFocusSpy = vi.spyOn(globalThis, 'focus').mockImplementation(() => undefined);
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events);
    });

    expect(MockNotification.instances).toHaveLength(1);
    const notification = MockNotification.instances[0];
    expect(notification.onclick).toBeTypeOf('function');

    notification.onclick?.(new Event('click'));

    expect(windowFocusSpy).toHaveBeenCalledOnce();
    expect(notification.close).toHaveBeenCalledOnce();

    windowFocusSpy.mockRestore();
  });

  it('does nothing when Notification API is unavailable', () => {
    vi.stubGlobal('Notification', undefined);
    const events = [makeEvent('run_completed')];

    renderHook(() => {
      useCompletionNotifications(events);
    });
  });
});
