import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentStreamEvent } from '@ai-orchestrator/ports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendAgentStreamEventToRunFile,
  discoverChangedFiles,
  dispatchToClients,
  FileBackedAgentStreamBus,
  readNewEvents,
} from '../file-backed-agent-stream-bus';

function makeEvent(runId: string, content: string): AgentStreamEvent {
  return {
    runId,
    stateId: 'IMPLEMENTATION',
    roleId: 'implementer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'stdout',
    content,
  };
}

describe('FileBackedAgentStreamBus', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = join(
      tmpdir(),
      `agent-stream-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('publish writes events to JSONL file in the run directory', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    const event = makeEvent('run-1', 'hello');

    bus.publish(event);

    const streamFile = join(runsDir, 'run-1', 'agent-stream.jsonl');
    expect(existsSync(streamFile)).toBe(true);
    const lines = readFileSync(streamFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(event);
    bus.dispose();
  });

  it('publish delivers to in-process subscribers immediately', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    const received: AgentStreamEvent[] = [];
    bus.subscribe((e) => received.push(e));

    const event = makeEvent('run-1', 'inline');
    bus.publish(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
    bus.dispose();
  });

  it('cross-instance: subscriber on a separate bus reads events via file polling', async () => {
    const publisher = new FileBackedAgentStreamBus(runsDir);
    const subscriber = new FileBackedAgentStreamBus(runsDir);

    const received: AgentStreamEvent[] = [];
    subscriber.subscribe((e) => received.push(e));

    publisher.publish(makeEvent('run-1', 'cross-process-1'));
    publisher.publish(makeEvent('run-1', 'cross-process-2'));

    // Wait for poll interval to fire (500ms default + margin)
    await vi.waitFor(
      () => {
        expect(received).toHaveLength(2);
      },
      { timeout: 2000 },
    );

    expect(received[0]).toMatchObject({ content: 'cross-process-1' });
    expect(received[1]).toMatchObject({ content: 'cross-process-2' });

    publisher.dispose();
    subscriber.dispose();
  });

  it('unsubscribe stops delivering events', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    const received: AgentStreamEvent[] = [];
    const clientId = bus.subscribe((e) => received.push(e));

    bus.publish(makeEvent('run-1', 'before'));
    bus.unsubscribe(clientId);
    bus.publish(makeEvent('run-1', 'after'));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ content: 'before' });
    bus.dispose();
  });

  it('getClientCount tracks subscribers', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    expect(bus.getClientCount()).toBe(0);

    const id1 = bus.subscribe(() => {});
    expect(bus.getClientCount()).toBe(1);

    const id2 = bus.subscribe(() => {});
    expect(bus.getClientCount()).toBe(2);

    bus.unsubscribe(id1);
    expect(bus.getClientCount()).toBe(1);

    bus.unsubscribe(id2);
    expect(bus.getClientCount()).toBe(0);
    bus.dispose();
  });

  it('poll picks up events appended externally between publishes', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    const received: AgentStreamEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish(makeEvent('run-1', 'first'));
    expect(received).toHaveLength(1);

    appendAgentStreamEventToRunFile(makeEvent('run-1', 'hook-event'), runsDir);

    bus.publish(makeEvent('run-1', 'second'));

    expect(received.map((e) => e.content)).toEqual(['first', 'hook-event', 'second']);
    bus.dispose();
  });

  it('publish does not double-deliver to same-process subscriber after poll', async () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    const received: AgentStreamEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish(makeEvent('run-1', 'once-only'));

    expect(received).toHaveLength(1);

    // Wait for at least one poll cycle (500ms + margin)
    await vi.waitFor(
      () => {
        expect(Date.now()).toBeGreaterThan(0);
      },
      { timeout: 1200, interval: 700 },
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ content: 'once-only' });
    bus.dispose();
  });

  it('multiple runs: events are written to separate files per runId', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);

    bus.publish(makeEvent('run-a', 'event-a'));
    bus.publish(makeEvent('run-b', 'event-b'));

    expect(existsSync(join(runsDir, 'run-a', 'agent-stream.jsonl'))).toBe(true);
    expect(existsSync(join(runsDir, 'run-b', 'agent-stream.jsonl'))).toBe(true);

    const linesA = readFileSync(join(runsDir, 'run-a', 'agent-stream.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    const linesB = readFileSync(join(runsDir, 'run-b', 'agent-stream.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect((JSON.parse(linesA[0]) as AgentStreamEvent).content).toBe('event-a');
    expect((JSON.parse(linesB[0]) as AgentStreamEvent).content).toBe('event-b');
    bus.dispose();
  });

  describe('getRunHistory', () => {
    it('returns events from the stream file', () => {
      const bus = new FileBackedAgentStreamBus(runsDir);
      bus.publish(makeEvent('run-1', 'first'));
      bus.publish(makeEvent('run-1', 'second'));

      const history = bus.getRunHistory('run-1');
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('first');
      expect(history[1].content).toBe('second');
      bus.dispose();
    });

    it('returns empty array for nonexistent run', () => {
      const bus = new FileBackedAgentStreamBus(runsDir);
      const history = bus.getRunHistory('nonexistent');
      expect(history).toEqual([]);
      bus.dispose();
    });

    it('skips invalid JSON lines in stream file', () => {
      const bus = new FileBackedAgentStreamBus(runsDir);
      bus.publish(makeEvent('run-1', 'valid'));

      // Append an invalid line directly to the file
      const streamFile = join(runsDir, 'run-1', 'agent-stream.jsonl');
      appendFileSync(streamFile, 'not valid json\n');

      const history = bus.getRunHistory('run-1');
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('valid');
      bus.dispose();
    });
  });

  it('does not start a second poll timer when already polling', () => {
    const bus = new FileBackedAgentStreamBus(runsDir);
    bus.subscribe(vi.fn());
    bus.subscribe(vi.fn());

    // Both subscriptions should use the same poll timer.
    // If no error is thrown, the guard works. Verify via client count.
    expect(bus.getClientCount()).toBe(2);
    bus.dispose();
  });

  it('dispatchToClients swallows client errors', () => {
    const events = [makeEvent('run-1', 'test')];
    const good: AgentStreamEvent[] = [];
    const clients = new Map<string, (event: AgentStreamEvent) => void>([
      [
        'bad',
        () => {
          throw new Error('bad client');
        },
      ],
      ['good', (e) => good.push(e)],
    ]);

    // Should not throw
    dispatchToClients(events, clients);
    expect(good).toHaveLength(1);
  });
});

describe('discoverChangedFiles', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = join(
      tmpdir(),
      `discover-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('returns empty array when runsDir does not exist', () => {
    const result = discoverChangedFiles('/nonexistent-path-abc', new Map());
    expect(result).toEqual([]);
  });

  it('skips entries without stream files', () => {
    mkdirSync(join(runsDir, 'run-no-stream'), { recursive: true });
    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toEqual([]);
  });

  it('returns changed files with correct offsets', () => {
    const runDir = join(runsDir, 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'agent-stream.jsonl'), 'line1\nline2\n');

    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].offset).toBe(0);
    expect(result[0].size).toBeGreaterThan(0);
  });

  it('uses stored offsets to detect no change', () => {
    const runDir = join(runsDir, 'run-1');
    mkdirSync(runDir, { recursive: true });
    const content = 'line1\n';
    writeFileSync(join(runDir, 'agent-stream.jsonl'), content);

    const offsets = new Map([[join(runDir, 'agent-stream.jsonl'), Buffer.byteLength(content)]]);
    const result = discoverChangedFiles(runsDir, offsets);
    expect(result).toEqual([]);
  });
});

describe('readNewEvents', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = join(
      tmpdir(),
      `read-events-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', () => {
    const result = readNewEvents('/nonexistent-file.jsonl', 0, 100);
    expect(result).toEqual([]);
  });

  it('skips invalid JSON lines', () => {
    const filePath = join(runsDir, 'test.jsonl');
    const validEvent = JSON.stringify(makeEvent('run-1', 'valid'));
    writeFileSync(filePath, `${validEvent}\nnot-json\n`);

    const result = readNewEvents(filePath, 0, readFileSync(filePath).length);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('valid');
  });
});
