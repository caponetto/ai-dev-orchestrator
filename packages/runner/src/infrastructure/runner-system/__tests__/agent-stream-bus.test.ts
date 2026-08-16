import type { AgentStreamEvent } from '@ai-orchestrator/ports';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryAgentStreamBus } from '../agent-stream-bus';

function makeEvent(overrides: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
  return {
    runId: 'run-001',
    stateId: 'PLAN_REVIEW',
    roleId: 'plan_reviewer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'stdout',
    content: 'hello',
    ...overrides,
  };
}

describe('InMemoryAgentStreamBus', () => {
  it('delivers published events to subscribers', () => {
    const bus = new InMemoryAgentStreamBus();
    const received: AgentStreamEvent[] = [];
    bus.subscribe((e) => received.push(e));

    const event = makeEvent();
    bus.publish(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it('delivers to multiple subscribers', () => {
    const bus = new InMemoryAgentStreamBus();
    const a: AgentStreamEvent[] = [];
    const b: AgentStreamEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.publish(makeEvent());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new InMemoryAgentStreamBus();
    const received: AgentStreamEvent[] = [];
    const clientId = bus.subscribe((e) => received.push(e));

    bus.publish(makeEvent());
    expect(received).toHaveLength(1);

    bus.unsubscribe(clientId);
    bus.publish(makeEvent({ content: 'after' }));
    expect(received).toHaveLength(1);
  });

  it('isolates errors in one subscriber from others', () => {
    const bus = new InMemoryAgentStreamBus();
    const received: AgentStreamEvent[] = [];

    bus.subscribe(() => {
      throw new Error('bad client');
    });
    bus.subscribe((e) => received.push(e));

    bus.publish(makeEvent());
    expect(received).toHaveLength(1);
  });

  it('tracks client count', () => {
    const bus = new InMemoryAgentStreamBus();
    expect(bus.getClientCount()).toBe(0);

    const id1 = bus.subscribe(vi.fn());
    expect(bus.getClientCount()).toBe(1);

    const id2 = bus.subscribe(vi.fn());
    expect(bus.getClientCount()).toBe(2);

    bus.unsubscribe(id1);
    expect(bus.getClientCount()).toBe(1);

    bus.unsubscribe(id2);
    expect(bus.getClientCount()).toBe(0);
  });

  it('returns unique client IDs', () => {
    const bus = new InMemoryAgentStreamBus();
    const id1 = bus.subscribe(vi.fn());
    const id2 = bus.subscribe(vi.fn());
    expect(id1).not.toBe(id2);
  });

  describe('getRunHistory', () => {
    it('returns events for a run that has been published to', () => {
      const bus = new InMemoryAgentStreamBus();
      const event1 = makeEvent({ content: 'first' });
      const event2 = makeEvent({ content: 'second' });
      bus.publish(event1);
      bus.publish(event2);

      const history = bus.getRunHistory('run-001');
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(event1);
      expect(history[1]).toEqual(event2);
    });

    it('returns empty array for unknown runId', () => {
      const bus = new InMemoryAgentStreamBus();
      bus.publish(makeEvent({ runId: 'run-001' }));

      const history = bus.getRunHistory('run-nonexistent');
      expect(history).toEqual([]);
    });

    it('returns empty array when no events published', () => {
      const bus = new InMemoryAgentStreamBus();
      const history = bus.getRunHistory('any-run');
      expect(history).toEqual([]);
    });

    it('isolates history by runId', () => {
      const bus = new InMemoryAgentStreamBus();
      bus.publish(makeEvent({ runId: 'run-a', content: 'a-event' }));
      bus.publish(makeEvent({ runId: 'run-b', content: 'b-event' }));

      expect(bus.getRunHistory('run-a')).toHaveLength(1);
      expect(bus.getRunHistory('run-a')[0].content).toBe('a-event');
      expect(bus.getRunHistory('run-b')).toHaveLength(1);
      expect(bus.getRunHistory('run-b')[0].content).toBe('b-event');
    });
  });
});
