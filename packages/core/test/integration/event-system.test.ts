import type { EventJournal } from '@ai-orchestrator/ports';
import type {
  Event,
  EventInput,
  RunStartedData,
  SystemWarningData,
} from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriberError } from '../../src/domain/event-system/errors';
import { InMemoryEventBus } from '../../src/infrastructure/event-system/in-memory-event-bus';

function createBus(onError?: (e: SubscriberError) => void) {
  return new InMemoryEventBus({
    runId: '20250115-103000-abc123',
    clock: () => 1700000000000,
    onSubscriberError: onError,
  });
}

function runStartedInput(): EventInput {
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

function createJournal(): EventJournal & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    append: (e: Event) => events.push(e),
    readAll: () => events,
    readFrom: (afterSeq: number) => events.filter((e) => e.sequence > afterSeq),
  };
}

describe('Event System Integration', () => {
  it('end-to-end: publish → sync subscriber captures → verify delivery', () => {
    const bus = createBus();
    const journal: Event[] = [];

    bus.subscribe(
      {},
      (e) => {
        journal.push(e);
      },
      {
        mode: 'sync',
        priority: 10,
        name: 'journal-writer',
      },
    );

    const published = bus.publish(runStartedInput());

    expect(journal).toHaveLength(1);
    expect(journal[0]).toBe(published);
    expect(published.id).toMatch(/^evt-/);
    expect(published.runId).toBe('20250115-103000-abc123');
    expect(published.sequence).toBe(1);
    expect(published.type).toBe('run.started');
  });

  it('sync subscribers block publisher and execute before async', async () => {
    const bus = createBus();
    const order: string[] = [];

    bus.subscribe(
      {},
      () => {
        order.push('sync-journal');
      },
      {
        mode: 'sync',
        priority: 10,
        name: 'journal',
      },
    );
    bus.subscribe(
      {},
      () => {
        order.push('sync-governance');
      },
      {
        mode: 'sync',
        priority: 30,
        name: 'governance',
      },
    );
    bus.subscribe(
      {},
      () => {
        order.push('async-dashboard');
      },
      {
        mode: 'async',
        priority: 100,
        name: 'dashboard',
      },
    );

    bus.publish(runStartedInput());

    expect(order[0]).toBe('sync-journal');
    expect(order[1]).toBe('sync-governance');

    await vi.waitFor(() => {
      expect(order[2]).toBe('async-dashboard');
    });
  });

  it('failing async subscriber does not affect other subscribers', () => {
    const errors: SubscriberError[] = [];
    const bus = createBus((e) => {
      errors.push(e);
    });
    const received: Event[] = [];

    bus.subscribe(
      {},
      () => {
        throw new Error('subscriber crash');
      },
      { mode: 'sync', priority: 10, name: 'crashing' },
    );
    bus.subscribe(
      {},
      (e) => {
        received.push(e);
      },
      {
        mode: 'sync',
        priority: 20,
        name: 'healthy',
      },
    );

    bus.publish(runStartedInput());

    expect(received).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.subscriberName).toBe('crashing');
  });

  it('multi-event flow with sequence ordering', () => {
    const bus = createBus();
    const events: Event[] = [];

    bus.subscribe(
      {},
      (e) => {
        events.push(e);
      },
      {
        mode: 'sync',
        priority: 10,
      },
    );

    bus.publish(runStartedInput());
    bus.publish({
      type: 'state.entered',
      source: 'workflow_engine',
      data: { stateId: 'PLANNING', stateType: 'active', entryActionsCount: 1 },
    });
    bus.publish({
      type: 'worker.dispatched',
      source: 'runner_system',
      data: {
        workerId: 'w-001',
        role: 'planner',
        model: 'claude-opus-4-6',
        inputArtifacts: [],
      },
    });

    expect(events).toHaveLength(3);
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.sequence).toBe(2);
    expect(events[2]?.sequence).toBe(3);
    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'state.entered',
      'worker.dispatched',
    ]);
  });

  it('replay delivers historical events to late-joining subscriber', () => {
    const bus = createBus();
    const journal: Event[] = [];

    bus.subscribe(
      {},
      (e) => {
        journal.push(e);
      },
      {
        mode: 'sync',
        priority: 10,
      },
    );

    bus.publish(runStartedInput());
    bus.publish({
      type: 'state.entered',
      source: 'workflow_engine',
      data: { stateId: 'PLANNING', stateType: 'active', entryActionsCount: 1 },
    });

    const replayed: Event[] = [];
    bus.replay(journal, {}, (e) => {
      replayed.push(e);
    });

    expect(replayed).toHaveLength(2);
    expect(replayed[0]?.sequence).toBe(1);
    expect(replayed[1]?.sequence).toBe(2);
  });

  it('filtered replay only delivers matching events', () => {
    const bus = createBus();
    const journal: Event[] = [];

    bus.subscribe(
      {},
      (e) => {
        journal.push(e);
      },
      {
        mode: 'sync',
        priority: 10,
      },
    );

    bus.publish(runStartedInput());
    bus.publish({
      type: 'worker.dispatched',
      source: 'runner_system',
      data: {
        workerId: 'w-001',
        role: 'planner',
        model: 'claude-opus-4-6',
        inputArtifacts: [],
      },
    });

    const replayed: Event[] = [];
    bus.replay(journal, { types: ['worker.dispatched'] }, (e) => {
      replayed.push(e);
    });

    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.type).toBe('worker.dispatched');
  });

  describe('journal persistence end-to-end', () => {
    it('publish → journal persists → new bus replays from journal', () => {
      const journal = createJournal();

      const bus1 = new InMemoryEventBus({
        runId: 'run-persist',
        clock: () => 1700000000000,
        journal,
      });

      bus1.publish(runStartedInput());
      bus1.publish({
        type: 'state.entered',
        source: 'workflow_engine',
        data: { stateId: 'PLANNING', stateType: 'active', entryActionsCount: 1 },
      });

      expect(journal.events).toHaveLength(2);

      const bus2 = new InMemoryEventBus({
        runId: 'run-persist',
        clock: () => 1700000000000,
        journal,
      });

      const replayed: Event[] = [];
      bus2.replay({}, (e) => {
        replayed.push(e);
      });

      expect(replayed).toHaveLength(2);
      expect(replayed[0]?.type).toBe('run.started');
      expect(replayed[1]?.type).toBe('state.entered');
      expect(replayed[0]?.sequence).toBe(1);
      expect(replayed[1]?.sequence).toBe(2);
    });
  });

  describe('back-pressure under load', () => {
    it('handles burst of events with overflow and delivery', async () => {
      const warnings: Event[] = [];
      const asyncReceived: Event[] = [];

      const bus = new InMemoryEventBus({
        runId: 'run-burst',
        clock: () => 1700000000000,
        config: { maxAsyncQueueSize: 5 },
      });

      bus.subscribe(
        { types: ['system.warning'] },
        (e) => {
          warnings.push(e);
        },
        { mode: 'sync', name: 'warning-collector' },
      );

      bus.subscribe(
        { types: ['run.started'] },
        (e) => {
          asyncReceived.push(e);
        },
        { mode: 'async', name: 'async-collector' },
      );

      for (let i = 0; i < 20; i++) {
        bus.publish(runStartedInput());
      }

      await vi.waitFor(() => {
        expect(asyncReceived.length).toBeGreaterThan(0);
      });

      expect(warnings.length).toBeGreaterThan(0);
      expect((warnings[0]?.data as SystemWarningData).message).toContain('overflow');
    });
  });

  describe('timeout enforcement', () => {
    it('slow sync subscriber triggers timeout error', async () => {
      const errors: SubscriberError[] = [];
      const bus = new InMemoryEventBus({
        runId: 'run-timeout',
        clock: () => 1700000000000,
        onSubscriberError: (e) => errors.push(e),
        config: { syncTimeout: 50 },
      });

      bus.subscribe({}, () => new Promise(() => {}), { mode: 'sync', name: 'frozen-handler' });

      bus.publish(runStartedInput());

      await vi.waitFor(() => {
        expect(errors).toHaveLength(1);
      });

      expect(errors[0]?.message).toContain('Timeout');
    });
  });
});
