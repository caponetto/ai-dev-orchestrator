import type { Event, EventInput } from '@ai-dev-orchestrator/schemas';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryEventBus } from '../in-memory-event-bus';

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
    },
  };
}

describe('Property-based: Event System', () => {
  it('every published event has a unique ID', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 50 }), (count) => {
        const bus = new InMemoryEventBus({
          runId: 'run-prop',
          clock: () => 1700000000000,
        });

        const ids = new Set<string>();
        for (let i = 0; i < count; i++) {
          const event = bus.publish(sampleInput());
          ids.add(event.id);
        }

        expect(ids.size).toBe(count);
      }),
      { numRuns: 50 },
    );
  });

  it('sequence numbers are strictly monotonically increasing with no gaps', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (count) => {
        const bus = new InMemoryEventBus({
          runId: 'run-prop',
          clock: () => 1700000000000,
        });

        const sequences: number[] = [];
        for (let i = 0; i < count; i++) {
          const event = bus.publish(sampleInput());
          sequences.push(event.sequence);
        }

        for (let i = 1; i < sequences.length; i++) {
          expect(sequences[i]).toBe(sequences[i - 1] + 1);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('sync subscribers always called before async subscribers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (syncCount, asyncCount) => {
          const bus = new InMemoryEventBus({
            runId: 'run-prop',
            clock: () => 1700000000000,
          });

          const order: string[] = [];

          for (let i = 0; i < asyncCount; i++) {
            bus.subscribe(
              {},
              () => {
                order.push('async');
              },
              { mode: 'async' },
            );
          }

          for (let i = 0; i < syncCount; i++) {
            bus.subscribe(
              {},
              () => {
                order.push('sync');
              },
              { mode: 'sync' },
            );
          }

          bus.publish(sampleInput());

          const syncEntries = order.slice(0, syncCount);
          expect(syncEntries.every((s) => s === 'sync')).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('filtered subscriber never receives non-matching events', () => {
    const eventTypes = ['run.started', 'run.completed', 'system.error', 'system.warning'] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...eventTypes),
        fc.integer({ min: 5, max: 20 }),
        (filterType, publishCount) => {
          const bus = new InMemoryEventBus({
            runId: 'run-prop',
            clock: () => 1700000000000,
          });

          const received: Event[] = [];
          bus.subscribe(
            { types: [filterType] },
            (e) => {
              received.push(e);
            },
            { mode: 'sync' },
          );

          for (let i = 0; i < publishCount; i++) {
            const type = eventTypes[i % eventTypes.length];
            const input: EventInput = {
              type,
              source: 'system',
              data:
                type === 'run.started'
                  ? { config: { workflow: 'default', repository: '/r', sourceType: 'git' } }
                  : type === 'run.completed'
                    ? {
                        outcome: 'success',
                        artifactCount: 0,
                        totalDurationMs: 0,
                        totalTokens: { input: 0, output: 0 },
                      }
                    : type === 'system.error'
                      ? { component: 'test', message: 'err', recoverable: true }
                      : { component: 'test', message: 'warn' },
            };
            bus.publish(input);
          }

          expect(received.every((e) => e.type === filterType)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});
