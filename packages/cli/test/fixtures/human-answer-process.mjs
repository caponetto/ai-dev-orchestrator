import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';

const [root, mode, content = 'accepted'] = process.argv.slice(2);
if (!root || !mode) throw new Error('Temporary root and mode are required');
os.homedir = () => root;
syncBuiltinESMExports();
process.chdir(root);
process.env.AI_ORCHESTRATOR_FIXTURE = '1';
const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
const { ResumeStatePersistence } = await import('../../src/resume-state-persistence.ts');
if (mode === 'crash-evaluation') {
  const { LifecycleController } = await import('@ai-dev-orchestrator/workflow');
  const restore = LifecycleController.prototype.restore;
  LifecycleController.prototype.restore = function (config, state) {
    restore.call(this, config, state);
    // Intercept this restored instance at the evaluation boundary in the disposable process.
    this.evaluator.evaluate = () => process.exit(77);
  };
}
const barrier = () => {
  process.send({ type: 'ready' });
  const path = join(root, `release-${process.pid}`);
  const deadline = Date.now() + 20_000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(path)) {
    if (Date.now() > deadline) throw new Error('Answer barrier timed out');
    Atomics.wait(wait, 0, 0, 10);
  }
};
if (mode === 'race' || mode === 'contention') {
  const acquire = ResumeStatePersistence.prototype.acquireLock;
  ResumeStatePersistence.prototype.acquireLock = function (id) {
    barrier();
    return acquire.call(this, id);
  };
}
if (mode === 'bootstrap-race') {
  const load = DefaultStatePersistence.prototype.load;
  let first = true;
  DefaultStatePersistence.prototype.load = function (id) {
    const state = load.call(this, id);
    if (first) {
      first = false;
      barrier();
    }
    return state;
  };
}
if (mode === 'crash-journal' || mode === 'crash-state') {
  const save = DefaultStatePersistence.prototype.save;
  DefaultStatePersistence.prototype.save = async function (state) {
    if (state.lastHumanAnswer?.content === content && mode === 'crash-journal') process.exit(73);
    await save.call(this, state);
    if (state.lastHumanAnswer?.content === content && mode === 'crash-state') process.exit(74);
  };
}
if (mode === 'crash-projection' || mode === 'projection-error') {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const accepted =
      String(to).endsWith('clarification_answers_v1.md') &&
      fs.readFileSync(from, 'utf8') === content;
    if (accepted && mode === 'projection-error') throw new Error('Projection unavailable');
    rename(from, to);
    if (accepted) process.exit(75);
  };
  syncBuiltinESMExports();
}
if (mode === 'crash-temporary') {
  const write = fs.writeFileSync;
  fs.writeFileSync = (path, data, options) => {
    if (
      String(path).includes('clarification_answers_v1.md.') &&
      String(path).endsWith('.tmp') &&
      data === content
    ) {
      write(path, content.slice(0, 3), options);
      process.exit(76);
    }
    return write(path, data, options);
  };
  syncBuiltinESMExports();
}
const { OutputFormatter } = await import('../../src/output/formatter.ts');
const formatter = new OutputFormatter({ json: true });
let code;
if (mode === 'resume') {
  const { resumeCommand } = await import('../../src/commands/resume.ts');
  code = await resumeCommand(root, { runId: 'answer', json: true, verbose: false }, formatter);
} else {
  const { answerCommand } = await import('../../src/commands/answer.ts');
  code = await answerCommand(
    {
      runId: 'answer',
      inputFile: null,
      messageId: null,
      answers: [content],
      json: true,
      verbose: false,
    },
    formatter,
  );
}
process.send?.({ type: 'result', code });
process.exitCode = code;
process.disconnect?.();
