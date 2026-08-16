import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentStreamEvent } from '@ai-orchestrator/ports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverChangedFiles,
  dispatchToClients,
  readNewEvents,
} from '../file-backed-agent-stream-bus';

function makeEvent(content: string): AgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'IMPLEMENTATION',
    roleId: 'implementer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'stdout',
    content,
  };
}

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
    const result = discoverChangedFiles('/nonexistent-dir-xyz', new Map());
    expect(result).toEqual([]);
  });

  it('returns empty array when runsDir is empty', () => {
    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toEqual([]);
  });

  it('returns files that have grown beyond known offset', () => {
    const runDir = join(runsDir, 'run-1');
    mkdirSync(runDir, { recursive: true });
    const streamFile = join(runDir, 'agent-stream.jsonl');
    const line = JSON.stringify(makeEvent('hello')) + '\n';
    writeFileSync(streamFile, line);

    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].streamFile).toBe(streamFile);
    expect(result[0].offset).toBe(0);
    expect(result[0].size).toBe(Buffer.byteLength(line));
  });

  it('skips files that have not grown beyond known offset', () => {
    const runDir = join(runsDir, 'run-1');
    mkdirSync(runDir, { recursive: true });
    const streamFile = join(runDir, 'agent-stream.jsonl');
    const line = JSON.stringify(makeEvent('hello')) + '\n';
    writeFileSync(streamFile, line);

    const offsets = new Map([[streamFile, Buffer.byteLength(line)]]);
    const result = discoverChangedFiles(runsDir, offsets);
    expect(result).toEqual([]);
  });

  it('discovers multiple changed files across runs', () => {
    for (const runId of ['run-a', 'run-b']) {
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'agent-stream.jsonl'), JSON.stringify(makeEvent(runId)) + '\n');
    }

    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toHaveLength(2);
  });

  it('skips entries without agent-stream.jsonl', () => {
    const runDir = join(runsDir, 'run-no-stream');
    mkdirSync(runDir, { recursive: true });

    const result = discoverChangedFiles(runsDir, new Map());
    expect(result).toEqual([]);
  });
});

describe('readNewEvents', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(
      tmpdir(),
      `read-events-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}.jsonl`,
    );
  });

  afterEach(() => {
    rmSync(tmpFile, { force: true });
  });

  it('returns empty array when file does not exist', () => {
    const result = readNewEvents('/nonexistent-file-xyz.jsonl', 0, 100);
    expect(result).toEqual([]);
  });

  it('reads events from beginning of file', () => {
    const event = makeEvent('first');
    const line = JSON.stringify(event) + '\n';
    writeFileSync(tmpFile, line);

    const result = readNewEvents(tmpFile, 0, Buffer.byteLength(line));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(event);
  });

  it('reads events from a byte offset', () => {
    const event1 = makeEvent('first');
    const event2 = makeEvent('second');
    const line1 = JSON.stringify(event1) + '\n';
    const line2 = JSON.stringify(event2) + '\n';
    writeFileSync(tmpFile, line1 + line2);

    const offset = Buffer.byteLength(line1);
    const size = Buffer.byteLength(line1 + line2);
    const result = readNewEvents(tmpFile, offset, size);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(event2);
  });

  it('skips malformed JSON lines', () => {
    const event = makeEvent('valid');
    const content = 'not-json\n' + JSON.stringify(event) + '\n';
    writeFileSync(tmpFile, content);

    const result = readNewEvents(tmpFile, 0, Buffer.byteLength(content));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(event);
  });

  it('reads multiple events', () => {
    const events = [makeEvent('a'), makeEvent('b'), makeEvent('c')];
    const content = events.map((e) => JSON.stringify(e) + '\n').join('');
    writeFileSync(tmpFile, content);

    const result = readNewEvents(tmpFile, 0, Buffer.byteLength(content));
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.content)).toEqual(['a', 'b', 'c']);
  });
});

describe('dispatchToClients', () => {
  it('dispatches each event to each client', () => {
    const received: string[] = [];
    const clients = new Map([
      ['c1', (e: AgentStreamEvent) => received.push(`c1:${e.content}`)],
      ['c2', (e: AgentStreamEvent) => received.push(`c2:${e.content}`)],
    ]);

    dispatchToClients([makeEvent('x'), makeEvent('y')], clients);
    expect(received).toEqual(['c1:x', 'c2:x', 'c1:y', 'c2:y']);
  });

  it('swallows client errors without stopping dispatch', () => {
    const received: string[] = [];
    const clients = new Map<string, (e: AgentStreamEvent) => void>([
      [
        'bad',
        () => {
          throw new Error('fail');
        },
      ],
      ['good', (e: AgentStreamEvent) => received.push(e.content)],
    ]);

    dispatchToClients([makeEvent('msg')], clients);
    expect(received).toEqual(['msg']);
  });

  it('does nothing with empty events', () => {
    const callback = vi.fn();
    const clients = new Map([['c1', callback]]);
    dispatchToClients([], clients);
    expect(callback).not.toHaveBeenCalled();
  });

  it('does nothing with empty clients', () => {
    const clients = new Map<string, (e: AgentStreamEvent) => void>();
    expect(() => {
      dispatchToClients([makeEvent('x')], clients);
    }).not.toThrow();
  });
});
