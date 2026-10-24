import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';

import { startLiveRequestPrompter } from '../../src/commands/live-request-prompter.ts';
import { OutputFormatter } from '../../src/output/formatter.ts';

const [root, mode] = process.argv.slice(2);
if (!root || !mode) throw new Error('Temporary root and mode required');
if (!process.stdin.isTTY) throw new Error('Fixture requires a real terminal');
process.env.NO_COLOR = '1';
const store = new FileBackedLiveRequestStore(root);
await store.writeRequest({
  runId: 'run',
  messageId: 'permission',
  kind: 'permission',
  createdAt: '1',
  expiresAt: mode === 'expiry' ? new Date(Date.now() + 2500).toISOString() : undefined,
  payload: { action: 'write', resource: 'file', riskLevel: 'low' },
});
await store.writeRequest({
  runId: 'run',
  messageId: 'clarification',
  kind: 'clarification',
  createdAt: '2',
  payload: { question: 'Which database?' },
});
if (mode === 'retry') {
  const write = store.writeResponse.bind(store);
  let first = true;
  store.writeResponse = async (...args) => {
    if (first) {
      first = false;
      throw new Error('fixture storage unavailable');
    }
    return write(...args);
  };
}
process.stdout.write(`TERMINAL_PID:${process.pid}\n`);
const prompter = startLiveRequestPrompter('run', store, new OutputFormatter({ noColor: true }));
try {
  const deadline = Date.now() + 15000;
  while (!existsSync(join(root, 'stop'))) {
    if (await store.awaitResponse('run', 'clarification', 0)) break;
    if (Date.now() > deadline) throw new Error('Terminal fixture timed out');
    await setTimeout(25);
  }
} finally {
  prompter.stop();
  process.stdin.pause();
}
process.stdout.write(
  'TERMINAL_RESULT:' +
    JSON.stringify({
      permission: await store.awaitResponse('run', 'permission', 0),
      clarification: await store.awaitResponse('run', 'clarification', 0),
    }) +
    '\n',
);
