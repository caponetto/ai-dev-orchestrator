import assert from 'node:assert/strict';
import { join } from 'node:path';

import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';

import { COMPLETION_RUN_ID, createRemoteCompletionHarness } from './remote-completion-harness';

const [mode, root] = process.argv.slice(2);
assert(root, 'missing fixture root directory');
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
