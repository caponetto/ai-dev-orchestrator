import type { Event, EventInput, EventType } from '@ai-orchestrator/schemas';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryEventBus } from '../in-memory-event-bus';

const EVENT_TYPES: EventType[] = [
  'run.started',
  'run.completed',
  'state.entered',
  'worker.dispatched',
  'system.error',
];

function createBus() {
  return new InMemoryEventBus({
    runId: 'run-test',
    clock: () => Date.now(),
  });
}

function makeInput(type: EventType): EventInput {
  return {
    type,
    source: 'workflow_engine',
    data: {
      config: { workflow: 'default', repository: '/repo', sourceType: 'git' },
    },
  };
}

describe('EventBus property-based tests', () => {
  it('every published event has a unique ID', () => {
    const bus = createBus();
    const ids = new Set<string>();

    fc.assert(
      fc.property(fc.constantFrom(...EVENT_TYPES), (type) => {
        const event = bus.publish(makeInput(type));
        expect(ids.has(event.id)).toBe(false);
        ids.add(event.id);
      }),
      { numRuns: 1000 },
    );
  });

  it('sequence numbers are strictly monotonically increasing with no gaps', () => {
    const bus = createBus();
    let lastSeq = 0;

    fc.assert(
      fc.property(fc.constantFrom(...EVENT_TYPES), (type) => {
        const event = bus.publish(makeInput(type));
        expect(event.sequence).toBe(lastSeq + 1);
        lastSeq = event.sequence;
      }),
      { numRuns: 500 },
    );
  });

  it('sync subscribers are always called before async subscribers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (syncCount, asyncCount) => {
          const bus = new InMemoryEventBus({
            runId: 'run-test',
            clock: () => 1700000000000,
          });
          const order: string[] = [];

          for (let i = 0; i < syncCount; i++) {
            bus.subscribe(
              {},
              () => {
                order.push('sync');
              },
              {
                mode: 'sync',
                priority: 50 + i,
              },
            );
          }
          for (let i = 0; i < asyncCount; i++) {
            bus.subscribe(
              {},
              () => {
                order.push('async');
              },
              {
                mode: 'async',
              },
            );
          }

          bus.publish(makeInput('run.started'));

          const firstAsyncIdx = order.indexOf('async');
          const lastSyncIdx = order.lastIndexOf('sync');

          if (firstAsyncIdx !== -1 && lastSyncIdx !== -1) {
            expect(lastSyncIdx).toBeLessThan(firstAsyncIdx);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtered subscriber never receives non-matching events', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EVENT_TYPES),
        fc.constantFrom(...EVENT_TYPES),
        (subscribedType, publishedType) => {
          const bus = new InMemoryEventBus({
            runId: 'run-test',
            clock: () => 1700000000000,
          });
          const received: Event[] = [];

          bus.subscribe(
            { types: [subscribedType] },
            (e) => {
              received.push(e);
            },
            { mode: 'sync' },
          );

          bus.publish(makeInput(publishedType));

          for (const event of received) {
            expect(event.type).toBe(subscribedType);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
