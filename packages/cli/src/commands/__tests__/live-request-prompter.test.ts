import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

import type { LiveRequest, LiveRequestStore } from '@ai-dev-orchestrator/runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutputFormatter } from '../../output/formatter';
import { startLiveRequestPrompter } from '../live-request-prompter';

vi.mock('node:readline', () => ({ createInterface: vi.fn() }));
class Terminal extends EventEmitter {
  answer!: (value: string) => void;
  question = vi.fn((_question: string, callback: (value: string) => void) => {
    this.answer = callback;
  });
  close = vi.fn(() => {
    this.emit('close');
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const permission: LiveRequest = {
  runId: 'run',
  messageId: 'permission',
  kind: 'permission',
  createdAt: '',
  payload: { action: 'write', resource: 'file', riskLevel: 'high', detail: 'replace file' },
};
const clarification: LiveRequest = {
  ...permission,
  messageId: 'clarification',
  kind: 'clarification',
  payload: { question: 'Which database?' },
};
let terminals: Terminal[];
let formatter: OutputFormatter;
let observed: ReturnType<typeof observe>;
function observe(output: OutputFormatter) {
  return {
    info: vi.spyOn(output, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(output, 'warn').mockImplementation(() => {}),
    success: vi.spyOn(output, 'success').mockImplementation(() => {}),
    summary: vi.spyOn(output, 'summary').mockImplementation(() => {}),
    spinner: vi.spyOn(output, 'startSpinner').mockImplementation(() => {}),
    clear: vi.spyOn(output, 'clearSpinner').mockImplementation(() => {}),
  };
}
let store: { [K in keyof LiveRequestStore]: ReturnType<typeof vi.fn<LiveRequestStore[K]>> };
let prompter: ReturnType<typeof startLiveRequestPrompter>;
const tick = () => vi.advanceTimersByTimeAsync(1000);
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => {
  vi.useFakeTimers();
  terminals = [];
  vi.mocked(createInterface)
    .mockReset()
    .mockImplementation(() => {
      const terminal = new Terminal();
      terminals.push(terminal);
      return terminal as unknown as ReturnType<typeof createInterface>;
    });
  store = {
    writeRequest: vi.fn(),
    writeResponse: vi.fn().mockResolvedValue('response_written'),
    awaitResponse: vi.fn(),
    listPendingRequests: vi.fn().mockResolvedValue([permission]),
    cleanupResolved: vi.fn(),
  };
  formatter = new OutputFormatter({ noColor: true });
  observed = observe(formatter);
  prompter = startLiveRequestPrompter('run', store, formatter);
});
afterEach(() => {
  prompter.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function terminal(index = 0): Terminal {
  const value = terminals.at(index);
  if (!value) {
    throw new Error('Expected open terminal');
  }
  return value;
}
describe('serialized interactive live requests', () => {
  it('does not open a terminal when no request is pending', async () => {
    store.listPendingRequests.mockResolvedValue([]);
    await tick();
    expect(terminals).toHaveLength(0);
    prompter.stop();
    await tick();
    expect(store.listPendingRequests).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['', true],
    ['Y', true],
    [' yes ', true],
    ['n', false],
    ['NO', false],
    [' no ', false],
  ])('parses permission input %j as granted=%s', async (input, granted) => {
    await tick();
    terminal().answer(input);
    await flush();
    expect(store.writeResponse).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ runId: 'run', messageId: 'permission', payload: { granted } }),
      { requireRequest: true },
    );
    expect(observed.info).toHaveBeenCalledWith('  Detail: replace file');
    expect(observed.info).toHaveBeenCalledWith('Live permission response stored (permission).');
  });
  it('rejects invalid permission text and reoffers the same request', async () => {
    await tick();
    terminal().answer('perhaps');
    await tick();
    expect(store.writeResponse).not.toHaveBeenCalled();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('Enter yes or no'));
    expect(terminals).toHaveLength(2);
    terminal(1).answer('no');
    await flush();
    expect(store.writeResponse).toHaveBeenCalledOnce();
  });
  it('rejects empty clarification input and preserves meaningful whitespace when retried', async () => {
    store.listPendingRequests.mockResolvedValue([clarification]);
    await tick();
    expect(terminal().question).toHaveBeenCalledWith('? Which database? ', expect.any(Function));
    terminal().answer('  ');
    await tick();
    expect(store.writeResponse).not.toHaveBeenCalled();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('non-empty answer'));
    terminal(1).answer('  PostgreSQL  ');
    await flush();
    expect(store.writeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { answer: '  PostgreSQL  ' } }),
      { requireRequest: true },
    );
    expect(observed.info).toHaveBeenCalledWith(
      'Live clarification response stored (clarification).',
    );
  });
  it.each([permission, clarification])(
    'uses safe display fallbacks for malformed $kind payload fields',
    async (request) => {
      store.listPendingRequests.mockResolvedValue([
        {
          ...request,
          payload: { action: 7, resource: null, riskLevel: false, detail: false, question: {} },
        },
      ]);
      await tick();
      expect(terminal().question).toHaveBeenCalledWith(
        request.kind === 'permission' ? '? unknown  (unknown risk). Allow? [Y/n] ' : '?  ',
        expect.any(Function),
      );
    },
  );
  it('serializes questions, waits for the first write, and ignores completed IDs in stale catalogs', async () => {
    const written = deferred<'response_written'>();
    store.listPendingRequests.mockResolvedValue([permission, clarification]);
    store.writeResponse.mockReturnValueOnce(written.promise);
    await tick();
    await tick();
    expect(terminals).toHaveLength(1);
    const first = terminal();
    first.answer('yes');
    first.answer('no');
    await tick();
    expect(terminals).toHaveLength(1);
    expect(store.writeResponse).toHaveBeenCalledOnce();
    expect(observed.info).not.toHaveBeenCalledWith(expect.stringContaining('response stored'));
    written.resolve('response_written');
    await tick();
    expect(terminals).toHaveLength(2);
    expect(terminal(1).question).toHaveBeenCalledWith('? Which database? ', expect.any(Function));
    terminal(1).answer('SQLite');
    await tick();
    expect(terminals).toHaveLength(2);
  });
  it.each(['already_responded', undefined] as const)(
    'acknowledges the store result %s, including legacy void adapters',
    async (outcome) => {
      store.writeResponse.mockResolvedValue(outcome);
      await tick();
      terminal().answer('yes');
      await flush();
      expect(observed.info).toHaveBeenCalledWith(
        outcome === 'already_responded'
          ? 'Live permission response already recorded (permission).'
          : 'Live permission response stored (permission).',
      );
    },
  );
  it('catches rejected writes locally and retries only while the request is pending', async () => {
    store.writeResponse.mockRejectedValueOnce(new Error('storage unavailable'));
    await tick();
    terminal().answer('yes');
    await tick();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('storage unavailable'));
    expect(terminals).toHaveLength(2);
    store.listPendingRequests.mockResolvedValue([]);
    await tick();
    terminal(1).answer('yes');
    await flush();
    expect(store.writeResponse).toHaveBeenCalledOnce();
  });
  it.each(['expired', 'already has a response', 'not found'])(
    'reports a %s race without claiming success or reoffering a resolved request',
    async (message) => {
      store.writeResponse.mockRejectedValueOnce(new Error(message));
      await tick();
      terminal().answer('yes');
      await flush();
      store.listPendingRequests.mockResolvedValue([]);
      await tick();
      expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining(message));
      expect(observed.info).not.toHaveBeenCalledWith(expect.stringContaining('response stored'));
      expect(terminals).toHaveLength(1);
    },
  );
  it('closes a stale question before opening its replacement and ignores late callbacks', async () => {
    await tick();
    const old = terminal();
    store.listPendingRequests.mockResolvedValue([clarification]);
    await tick();
    expect(old.close).toHaveBeenCalledOnce();
    expect(terminals).toHaveLength(2);
    old.answer('yes');
    await flush();
    expect(store.writeResponse).not.toHaveBeenCalled();
    expect(observed.info).toHaveBeenCalledWith(expect.stringContaining('no longer pending'));
  });
  it('does not overlap slow polls and permits a retry after a read failure', async () => {
    const read = deferred<readonly LiveRequest[]>();
    store.listPendingRequests.mockReturnValueOnce(read.promise);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.listPendingRequests).toHaveBeenCalledOnce();
    read.reject(new Error('catalog unavailable'));
    await flush();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('catalog unavailable'));
    await tick();
    expect(terminals).toHaveLength(1);
  });
  it('recovers if opening the terminal throws', async () => {
    vi.mocked(createInterface).mockImplementationOnce(() => {
      throw new Error('terminal unavailable');
    });
    await tick();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('terminal unavailable'));
    await tick();
    expect(terminals).toHaveLength(1);
  });
  it('closes a terminal that fails to ask its question and retries on the next poll', async () => {
    const broken = new Terminal();
    broken.question.mockImplementationOnce(() => {
      throw new Error('question unavailable');
    });
    vi.mocked(createInterface).mockReturnValueOnce(
      broken as unknown as ReturnType<typeof createInterface>,
    );
    await tick();
    expect(broken.close).toHaveBeenCalledOnce();
    expect(observed.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('question unavailable'),
    );
    await tick();
    expect(terminals).toHaveLength(1);
  });
  it('treats EOF as unanswered input and stops opening questions', async () => {
    await tick();
    terminal().close();
    await tick();
    expect(observed.warn).toHaveBeenCalledWith(expect.stringContaining('Terminal input closed'));
    expect(store.writeResponse).not.toHaveBeenCalled();
    expect(store.listPendingRequests).toHaveBeenCalledOnce();
  });
  it('closes the terminal and ignores input after idempotent shutdown', async () => {
    await tick();
    prompter.stop();
    prompter.stop();
    terminal().answer('yes');
    await tick();
    expect(terminal().close).toHaveBeenCalledOnce();
    expect(store.writeResponse).not.toHaveBeenCalled();
    expect(observed.warn).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'does not open or report a delayed poll after shutdown (success=%s)',
    async (success) => {
      const read = deferred<readonly LiveRequest[]>();
      store.listPendingRequests.mockReturnValueOnce(read.promise);
      await tick();
      prompter.stop();
      if (success) {
        read.resolve([permission]);
      } else {
        read.reject(new Error('late read error'));
      }
      await tick();
      expect(terminals).toHaveLength(0);
      expect(observed.warn).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])(
    'does not announce or retry an in-flight write after shutdown (success=%s)',
    async (success) => {
      const written = deferred<'response_written'>();
      store.writeResponse.mockReturnValueOnce(written.promise);
      await tick();
      terminal().answer('yes');
      prompter.stop();
      observed.spinner.mockClear();
      if (success) {
        written.resolve('response_written');
      } else {
        written.reject(new Error('late write error'));
      }
      await tick();
      expect(store.writeResponse).toHaveBeenCalledOnce();
      expect(observed.info).not.toHaveBeenCalledWith(expect.stringContaining('response stored'));
      expect(observed.warn).not.toHaveBeenCalled();
      expect(observed.spinner).not.toHaveBeenCalled();
    },
  );
});
