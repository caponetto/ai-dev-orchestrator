import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';

import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';

const [mode, root] = process.argv.slice(2);
assert(root, 'missing fixture root directory');
// Stop immediately before or after the actual rename used by the atomic writer. The
// callback confirms the filesystem effect, without adding failure hooks to production code.
const rename = fs.rename;
fs.rename = Object.assign(
  (source: fs.PathLike, destination: fs.PathLike, callback: fs.NoParamCallback) => {
    const path = String(destination);
    const isContent = path.endsWith('/planner-output_v1.md');
    if (mode === 'crash-before-content' && isContent) {
      process.exit(73);
    }
    rename(source, destination, (error) => {
      if (
        !error &&
        ((mode === 'crash-after-content' && isContent) ||
          (mode === 'crash-after-metadata' && path.endsWith('/planner-output_v1.meta.yaml')) ||
          (mode === 'crash-after-inventory' && path.endsWith('/inventory.yaml')))
      ) {
        process.exit(73);
      }
      callback(error);
    });
  },
  { __promisify__: rename.__promisify__ },
);
const { COMPLETION_RUN_ID, createRemoteCompletionHarness } =
  await import('./remote-completion-harness');
const h = await createRemoteCompletionHarness(root);
let error: string | undefined;
if (mode === 'resume') {
  const state = h.persistence.reconstructFromJournal(
    COMPLETION_RUN_ID,
    new DefaultJournalReader(h.journalPath).readAll(),
  );
  assert(state);
  h.controller.restore(h.config, state);
  if (state.waitingContext) {
    await h.controller.resume({ type: 'approval', content: 'resume' });
  } else {
    await h.controller.retry();
  }
} else {
  await h.controller.start(h.config);
  await h.complete();
  await h.supervisor.finalize(h.ref.sessionId);
  if (mode === 'crash-before-artifact') {
    process.exit(73);
  }
  if (mode === 'crash-after-artifact') {
    const store = h.artifacts.store.bind(h.artifacts);
    h.artifacts.store = async (input) => {
      const ref = await store(input);
      if (input.name === 'planner-output') {
        process.exit(73);
      }
      return ref;
    };
  }
  if (mode === 'report-failure') {
    const write = h.manifestWriter.write.bind(h.manifestWriter);
    h.manifestWriter.write = (id, manifest) => {
      if (manifest.status === 'completed') {
        throw new Error('final manifest unavailable');
      }
      write(id, manifest);
    };
  }
  try {
    await h.controller.resume({ type: 'approval', content: 'continue' });
  } catch (cause) {
    if (mode !== 'report-failure') {
      throw cause;
    }
    error = String(cause);
  }
}
const state = h.persistence.load(COMPLETION_RUN_ID);
assert(state);
const refs = await h.artifacts.list({});
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    state: state.currentState,
    refs,
    inputTokens: state.cumulativeInputTokens,
    outputTokens: state.cumulativeOutputTokens,
    metrics: state.workerMetricsByRole,
    dispatches: h.dispatches(),
    integrity: await Promise.all(refs.map(async (ref) => (await h.artifacts.verify(ref)).valid)),
    locked: h.persistence.probeLock(COMPLETION_RUN_ID).exists,
    error,
    runDir: join(root, COMPLETION_RUN_ID),
  }) + '\n',
);
