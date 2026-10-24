import { appendFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, mode, target = 'DONE', decision = 'grant', build = 'source'] = process.argv.slice(2);
if (!root || !mode) throw new Error('Temporary root and mode required');
os.homedir = () => root;
syncBuiltinESMExports();
process.chdir(root);
process.env.AI_ORCHESTRATOR_FIXTURE = '1';
const { FileBackedLiveRequestStore } = await import('@ai-dev-orchestrator/runner');
const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
const store = new FileBackedLiveRequestStore(join(root, '.ai', 'runs'));
function barrier() {
  process.send?.({ type: 'ready' });
  const release = join(root, `release-${process.pid}`);
  const deadline = Date.now() + 20_000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(release)) {
    if (Date.now() > deadline) throw new Error('Permission barrier timed out');
    Atomics.wait(wait, 0, 0, 10);
  }
}
if (mode === 'writer') {
  if (target === 'hold') barrier();
  try {
    const outcome = await store.writeResponse(
      {
        runId: 'permission',
        messageId: 'selected',
        payload: { granted: decision === 'grant' },
        respondedAt: '',
      },
      { requireRequest: true },
    );
    process.stdout.write(JSON.stringify({ outcome }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1;
  }
} else if (mode === 'cleanup') {
  process.stdout.write(
    JSON.stringify({ cleaned: await store.cleanupResolved('permission') }) + '\n',
  );
} else {
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
  if (mode !== 'file') {
    const { LifecycleController } = await import('@ai-dev-orchestrator/workflow');
    const restore = LifecycleController.prototype.restore;
    LifecycleController.prototype.restore = function (config, state) {
      restore.call(this, config, state);
      const session = state.waitingContext.liveSessionId;
      const selected = state.waitingContext.pendingRequestId;
      const requestId = target === 'changed' ? 'new-request' : selected;
      this.sessionSupervisor = {
        attach: async () => ({
          ref: {
            runId: 'permission',
            sessionId: session,
            stateId: 'WORK',
            role: 'planner',
            transport: 'remote',
          },
          state: 'awaiting_human',
          pendingRequests: [{ requestId, kind: 'permission', createdAt: '', payload: {} }],
        }),
        sendHumanResponse: async (sessionId, id, payload) => {
          appendFileSync(
            join(root, 'delivered.jsonl'),
            JSON.stringify({ sessionId, requestId: id, payload }) + '\n',
          );
          return true;
        },
        waitForAdvance: async () => {
          if (target === 'ABORTED') {
            await this.abort('fixture interruption');
            return { kind: 'failed', error: 'aborted' };
          }
          if (target === 'FAILED') return { kind: 'failed', error: 'fixture agent failed' };
          if (target === 'WAITING_FOR_HUMAN')
            return {
              kind: 'awaiting_human',
              pendingRequest: { requestId: 'next', kind: 'permission', createdAt: '', payload: {} },
            };
          return {
            kind: 'completed',
            durationMs: 1,
            artifactContent: JSON.stringify({
              version: 1,
              specificationRef: { type: 'canonical_specification', name: 'input', version: 1 },
              createdAt: new Date().toISOString(),
              summary: 'Permission process fixture',
              tasks: [{ taskId: 'task', description: 'Verify', files: [], dependencies: [] }],
            }),
          };
        },
        abort: async () => true,
      };
    };
  }
  const entry = fileURLToPath(
    new URL(build === 'bundle' ? '../../dist/index.js' : '../../src/index.ts', import.meta.url),
  );
  process.argv = [
    process.execPath,
    entry,
    'permit',
    'permission',
    '--message-id',
    'selected',
    ...(decision === 'deny' ? ['--deny'] : []),
    '--json',
  ];
  await import(entry);
}
process.disconnect?.();
