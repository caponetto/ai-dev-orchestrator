import type { EventJournal } from '@ai-orchestrator/ports';
import type {
  Event,
  EventInput,
  RunStartedData,
  SystemWarningData,
} from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryEventBus } from '../in-memory-event-bus';

function createBus(overrides?: { clock?: () => number }) {
  return new InMemoryEventBus({
    runId: '20250115-103000-abc123',
    random: { randomInt: (max: number) => max - 1 },
    clock: overrides?.clock ?? (() => 1700000000000),
  });
}

function sampleInput(): EventInput {
  return {
    type: 'run.started',
    source: 'workflow_engine',
    data: {
      config: {
        workflow: 'default',
        repository: '/repo',
        sourceType: 'git',
      },
    } satisfies RunStartedData,
  };
}

describe('InMemoryEventBus', () => {
  it('enriches EventInput into Event with id, runId, sequence, timestamp', () => {
    const bus = createBus();
    const event = bus.publish(sampleInput());

    expect(event.id).toMatch(/^evt-/);
    expect(event.runId).toBe('20250115-103000-abc123');
    expect(event.sequence).toBe(1);
    expect(event.timestamp).toBe('2023-11-14T22:13:20.000Z');
    expect(event.type).toBe('run.started');
    expect(event.source).toBe('workflow_engine');
  });

  it('increments sequence for each published event', () => {
    const bus = createBus();
    const e1 = bus.publish(sampleInput());
    const e2 = bus.publish(sampleInput());
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
  });

  it('delivers events to sync subscribers in priority order', () => {
    const bus = createBus();
    const order: number[] = [];

    bus.subscribe(
      {},
      () => {
        order.push(100);
      },
      {
        mode: 'sync',
        priority: 100,
        name: 'low-priority',
      },
    );
    bus.subscribe(
      {},
      () => {
        order.push(10);
      },
      {
        mode: 'sync',
        priority: 10,
        name: 'high-priority',
      },
    );
    bus.subscribe(
      {},
      () => {
        order.push(50);
      },
      {
        mode: 'sync',
        priority: 50,
        name: 'mid-priority',
      },
    );

    bus.publish(sampleInput());
    expect(order).toEqual([10, 50, 100]);
  });

  it('defaults to async mode and priority 100', () => {
    const bus = createBus();
    const sub = bus.subscribe({}, () => {});
    expect(sub.options.mode).toBe('async');
    expect(sub.options.priority).toBe(100);
  });

  it('filters by event type', () => {
    const bus = createBus();
    const received: Event[] = [];

    bus.subscribe(
      { types: ['run.completed'] },
      (e) => {
        received.push(e);
      },
      { mode: 'sync' },
    );

    bus.publish(sampleInput());
    bus.publish({
      type: 'run.completed',
      source: 'workflow_engine',
      data: {
        outcome: 'success',
        artifactCount: 0,
        totalDurationMs: 1000,
        totalTokens: { input: 100, output: 200 },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('run.completed');
  });

  it('filters by source', () => {
    const bus = createBus();
    const received: Event[] = [];

    bus.subscribe(
      { source: 'system' },
      (e) => {
        received.push(e);
      },
      { mode: 'sync' },
    );

    bus.publish(sampleInput());
    bus.publish({
      type: 'system.error',
      source: 'system',
      data: { component: 'test', message: 'err', recoverable: true },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe('system');
  });

  it('filters by correlationId', () => {
    const bus = createBus();
    const received: Event[] = [];

    bus.subscribe(
      { correlationId: 'wrk-001' },
      (e) => {
        received.push(e);
      },
      { mode: 'sync' },
    );

    bus.publish({ ...sampleInput(), correlationId: 'wrk-002' });
    bus.publish({ ...sampleInput(), correlationId: 'wrk-001' });

    expect(received).toHaveLength(1);
    expect(received[0]?.correlationId).toBe('wrk-001');
  });

  it('empty filter matches all events', () => {
    const bus = createBus();
    const received: Event[] = [];

    bus.subscribe(
      {},
      (e) => {
        received.push(e);
      },
      { mode: 'sync' },
    );
    bus.publish(sampleInput());
    bus.publish({
      type: 'system.error',
      source: 'system',
      data: { component: 'test', message: 'err', recoverable: true },
    });

    expect(received).toHaveLength(2);
  });

  it('unsubscribe removes handler', () => {
    const bus = createBus();
    const received: Event[] = [];

    const sub = bus.subscribe(
      {},
      (e) => {
        received.push(e);
      },
      { mode: 'sync' },
    );

    bus.publish(sampleInput());
    expect(received).toHaveLength(1);

    bus.unsubscribe(sub);
    bus.publish(sampleInput());
    expect(received).toHaveLength(1);
  });

  it('sync subscriber error does not prevent subsequent subscribers', () => {
    const errors: Error[] = [];
    const busWithErrors = new InMemoryEventBus({
      runId: 'run-test',
      clock: () => 1700000000000,
      onSubscriberError: (e) => errors.push(e),
    });

    const received: string[] = [];

    busWithErrors.subscribe(
      {},
      () => {
        received.push('first');
      },
      {
        mode: 'sync',
        priority: 10,
        name: 'first',
      },
    );
    busWithErrors.subscribe(
      {},
      () => {
        throw new Error('boom');
      },
      { mode: 'sync', priority: 20, name: 'thrower' },
    );
    busWithErrors.subscribe(
      {},
      () => {
        received.push('third');
      },
      {
        mode: 'sync',
        priority: 30,
        name: 'third',
      },
    );

    busWithErrors.publish(sampleInput());
    expect(received).toEqual(['first', 'third']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('thrower');
  });

  it('async subscribers do not block publish', () => {
    const bus = createBus();
    const syncOrder: string[] = [];

    bus.subscribe(
      {},
      () => {
        syncOrder.push('sync');
      },
      {
        mode: 'sync',
        priority: 10,
      },
    );
    bus.subscribe(
      {},
      () => {
        syncOrder.push('async');
      },
      { mode: 'async' },
    );

    bus.publish(sampleInput());
    expect(syncOrder[0]).toBe('sync');
  });

  it('async subscriber error is captured by error handler', async () => {
    const errors: Error[] = [];
    const bus = new InMemoryEventBus({
      runId: 'run-test',
      clock: () => 1700000000000,
      onSubscriberError: (e) => errors.push(e),
    });

    bus.subscribe({}, () => Promise.reject(new Error('async boom')), {
      mode: 'async',
      name: 'async-thrower',
    });

    bus.publish(sampleInput());

    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    expect(errors[0]?.message).toContain('async-thrower');
  });

  it('replay delivers matching events to handler', () => {
    const bus = createBus();
    const replayed: Event[] = [];

    const events: Event[] = [
      {
        ...sampleInput(),
        id: 'evt-1',
        runId: 'run-test',
        sequence: 1,
        timestamp: '2025-01-15T10:30:00.000Z',
      },
      {
        type: 'system.error',
        source: 'system',
        data: { component: 'test', message: 'err', recoverable: true },
        id: 'evt-2',
        runId: 'run-test',
        sequence: 2,
        timestamp: '2025-01-15T10:30:01.000Z',
      },
    ];

    bus.replay(events, { types: ['run.started'] }, (e) => {
      replayed.push(e);
    });
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.type).toBe('run.started');
  });

  it('replay with empty filter delivers all events', () => {
    const bus = createBus();
    const replayed: Event[] = [];

    const events: Event[] = [
      {
        ...sampleInput(),
        id: 'evt-1',
        runId: 'run-test',
        sequence: 1,
        timestamp: '2025-01-15T10:30:00.000Z',
      },
      {
        ...sampleInput(),
        id: 'evt-2',
        runId: 'run-test',
        sequence: 2,
        timestamp: '2025-01-15T10:30:01.000Z',
      },
    ];

    bus.replay(events, {}, (e) => {
      replayed.push(e);
    });
    expect(replayed).toHaveLength(2);
  });

  describe('back-pressure', () => {
    it('delivers all events when queue is within capacity', async () => {
      const received: Event[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        config: { maxAsyncQueueSize: 10 },
      });

      bus.subscribe(
        {},
        (e) => {
          received.push(e);
        },
        { mode: 'async', name: 'collector' },
      );

      for (let i = 0; i < 5; i++) {
        bus.publish(sampleInput());
      }

      await vi.waitFor(() => {
        expect(received).toHaveLength(5);
      });
    });

    it('drops oldest async entry and emits system.warning on overflow', () => {
      const warnings: Event[] = [];
      const received: Event[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        config: { maxAsyncQueueSize: 3 },
      });

      bus.subscribe(
        { types: ['system.warning'] },
        (e) => {
          warnings.push(e);
        },
        { mode: 'sync', name: 'warning-watcher' },
      );

      bus.subscribe(
        { types: ['run.started'] },
        (e) => {
          received.push(e);
        },
        { mode: 'async', name: 'slow-consumer' },
      );

      for (let i = 0; i < 5; i++) {
        bus.publish(sampleInput());
      }

      expect(warnings.length).toBeGreaterThan(0);
      expect((warnings[0]?.data as SystemWarningData).message).toContain('overflow');
    });

    it('sync delivery is never dropped regardless of queue state', () => {
      const syncReceived: Event[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        config: { maxAsyncQueueSize: 1 },
      });

      bus.subscribe(
        { types: ['run.started'] },
        (e) => {
          syncReceived.push(e);
        },
        { mode: 'sync', name: 'sync-sub' },
      );

      bus.subscribe({}, () => {}, { mode: 'async', name: 'async-filler' });

      for (let i = 0; i < 10; i++) {
        bus.publish(sampleInput());
      }

      expect(syncReceived).toHaveLength(10);
    });
  });

  describe('sync timeout', () => {
    it('interrupts sync handler that returns a slow Promise', async () => {
      const errors: Error[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        onSubscriberError: (e) => errors.push(e),
        config: { syncTimeout: 50 },
      });

      bus.subscribe({}, () => new Promise(() => {}), { mode: 'sync', name: 'slow-sync' });

      bus.publish(sampleInput());

      await vi.waitFor(() => {
        expect(errors).toHaveLength(1);
      });
      expect(errors[0]?.message).toContain('Timeout');
    });

    it('truly sync handler executes normally regardless of timeout config', () => {
      const received: Event[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        config: { syncTimeout: 1 },
      });

      bus.subscribe(
        {},
        (e) => {
          received.push(e);
        },
        { mode: 'sync', name: 'fast-sync' },
      );

      bus.publish(sampleInput());
      expect(received).toHaveLength(1);
    });
  });

  describe('consecutive failure tracking', () => {
    it('auto-unsubscribes async handler after N consecutive failures', async () => {
      const errors: Error[] = [];
      const warnings: Event[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        onSubscriberError: (e) => errors.push(e),
        config: { maxConsecutiveFailures: 3 },
      });

      bus.subscribe(
        { types: ['system.warning'] },
        (e) => {
          warnings.push(e);
        },
        { mode: 'sync', name: 'warning-watcher' },
      );

      bus.subscribe(
        { types: ['run.started'] },
        () => {
          throw new Error('always fails');
        },
        { mode: 'async', name: 'flaky-sub' },
      );

      for (let i = 0; i < 4; i++) {
        bus.publish(sampleInput());
      }

      await vi.waitFor(() => {
        expect(errors.length).toBeGreaterThanOrEqual(3);
      });

      expect(
        warnings.some((w) => (w.data as SystemWarningData).message.includes('Auto-unsubscribed')),
      ).toBe(true);
    });

    it('resets failure count on success, stays subscribed', async () => {
      let callCount = 0;
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        onSubscriberError: () => {},
        config: { maxConsecutiveFailures: 3 },
      });

      bus.subscribe(
        {},
        () => {
          callCount++;
          if (callCount % 3 !== 0) {
            throw new Error('intermittent');
          }
        },
        { mode: 'async', name: 'intermittent-sub' },
      );

      for (let i = 0; i < 9; i++) {
        bus.publish(sampleInput());
      }

      await vi.waitFor(() => {
        expect(callCount).toBe(9);
      });
    });
  });

  describe('event persistence', () => {
    function createJournal(): EventJournal & { events: Event[] } {
      const events: Event[] = [];
      return {
        events,
        append: (e: Event) => events.push(e),
        readAll: () => events,
        readFrom: (afterSeq: number) => events.filter((e) => e.sequence > afterSeq),
      };
    }

    it('appends events to journal on publish', () => {
      const journal = createJournal();
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        journal,
      });

      bus.publish(sampleInput());
      bus.publish(sampleInput());

      expect(journal.events).toHaveLength(2);
      expect(journal.events[0]?.sequence).toBe(1);
      expect(journal.events[1]?.sequence).toBe(2);
    });

    it('replay without events array reads from journal', () => {
      const journal = createJournal();
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        journal,
      });

      bus.publish(sampleInput());
      bus.publish({
        type: 'system.error',
        source: 'system',
        data: { component: 'test', message: 'err', recoverable: true },
      });

      const replayed: Event[] = [];
      bus.replay({ types: ['run.started'] }, (e) => {
        replayed.push(e);
      });

      expect(replayed).toHaveLength(1);
      expect(replayed[0]?.type).toBe('run.started');
    });

    it('replay with events array uses provided events (backwards compat)', () => {
      const journal = createJournal();
      const bus = new InMemoryEventBus({
        runId: 'run-test',
        clock: () => 1700000000000,
        journal,
      });

      bus.publish(sampleInput());

      const manualEvents: Event[] = [
        {
          ...sampleInput(),
          type: 'system.error',
          source: 'system',
          data: { component: 'x', message: 'y', recoverable: true },
          id: 'evt-manual',
          runId: 'run-test',
          sequence: 99,
          timestamp: '2025-01-01T00:00:00Z',
        },
      ];

      const replayed: Event[] = [];
      bus.replay(manualEvents, {}, (e) => {
        replayed.push(e);
      });

      expect(replayed).toHaveLength(1);
      expect(replayed[0]?.id).toBe('evt-manual');
    });

    it('replay without journal is a no-op', () => {
      const bus = createBus();
      const replayed: Event[] = [];

      bus.replay({}, (e) => {
        replayed.push(e);
      });

      expect(replayed).toHaveLength(0);
    });
  });
});
