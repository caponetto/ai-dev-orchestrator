import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';

const [root, id] = process.argv.slice(2);
if (!root || !id || !process.send) throw new Error('A temporary root, run ID and IPC are required');
os.homedir = () => root;
syncBuiltinESMExports();
const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
const acquire = DefaultStatePersistence.prototype.acquireLock;
DefaultStatePersistence.prototype.acquireLock = function (runId) {
  process.send({ type: 'before-acquire' });
  const release = join(root, 'continue');
  const deadline = Date.now() + 20_000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(release)) {
    if (Date.now() > deadline) throw new Error('Ownership barrier timed out');
    Atomics.wait(wait, 0, 0, 10);
  }
  return acquire.call(this, runId);
};
const { abortCommand } = await import('../../src/commands/abort.ts');
const { OutputFormatter } = await import('../../src/output/formatter.ts');
const chunks = [];
process.stdout.write = (chunk) => {
  chunks.push(String(chunk));
  return true;
};
const code = await abortCommand(
  { runId: id, json: true, verbose: false, force: false },
  new OutputFormatter({ json: true }),
);
process.send({ type: 'result', code, output: chunks.join('') });
process.exitCode = code;
process.disconnect();
