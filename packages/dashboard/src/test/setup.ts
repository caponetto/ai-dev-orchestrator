import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from './server';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => {
  server.close();
});

// Minimal shims for APIs not available in jsdom
if (typeof window !== 'undefined') {
  // ResizeObserver is required by @xyflow/react
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  window.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  // EventSource is required by useEventStream
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  window.EventSource ??= class EventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    url: string;
    withCredentials = false;
    onopen: ((this: EventSource, ev: Event) => void) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
    onerror: ((this: EventSource, ev: Event) => void) | null = null;
    constructor(url: string | URL) {
      super();
      this.url = typeof url === 'string' ? url : url.toString();
    }
    close() {
      this.readyState = 2;
    }
  } as unknown as typeof EventSource;
}
