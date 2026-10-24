import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';

const [mode, root, id = 'ownership'] = process.argv.slice(2);
if (!root || !process.send) throw new Error('An IPC channel and temporary root are required');
os.homedir = () => root;
syncBuiltinESMExports();
process.env.AI_ORCHESTRATOR_FIXTURE = '1';
const send = (type, data = {}) => process.send({ type, ...data });
const commands = [];
let receiver;
process.on('message', (command) => {
  if (receiver) {
    const resolve = receiver;
    receiver = undefined;
    resolve(command);
  } else commands.push(command);
});
const next = () =>
  commands.length
    ? Promise.resolve(commands.shift())
    : new Promise((resolve) => {
        receiver = resolve;
      });
const runsDir = join(root, '.ai', 'runs');
const runDir = join(runsDir, id);

if (mode === 'publish-crash') {
  const write = fs.writeFileSync;
  fs.writeFileSync = (path, data, options) => {
    if (String(path).endsWith('/run.lock') && options?.flag === 'wx') {
      fs.openSync(path, 'wx');
      process.exit(73);
    }
    return write(path, data, options);
  };
  syncBuiltinESMExports();
}
if (mode === 'reclaim-crash') {
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = (path, options) => {
    const result = mkdir(path, options);
    if (String(path).includes('.reclaim-')) process.exit(73);
    return result;
  };
  syncBuiltinESMExports();
}
const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
const persistence = new DefaultStatePersistence(runsDir);
if (mode.startsWith('seed-')) {
  const { generateAll } = await import('@ai-dev-orchestrator/config-templates');
  for (const [name, content] of generateAll()) {
    const path = join(root, '.ai', name);
    fs.mkdirSync(join(path, '..'), { recursive: true });
    fs.writeFileSync(path, content);
  }
  fs.writeFileSync(
    join(root, '.ai', 'templates', 'planner.md'),
    [
      '---',
      'role: planner',
      'version: 1.0.0',
      'description: Deterministic ownership fixture',
      'variables: []',
      'output_contract:',
      '  role: planner',
      '  artifact_type: plan',
      '  format: json',
      '  required: true',
      '  repair_enabled: false',
      '  max_repair_attempts: 0',
      '---',
      'Produce the deterministic fixture plan.',
    ].join('\n'),
  );
  const transition = (target, trigger) => ({
    target,
    trigger,
    guards: [],
    priority: 0,
    governanceRequired: false,
  });
  const definition = {
    name: 'ownership',
    version: '1',
    initialState: 'WAITING_FOR_HUMAN',
    terminalStates: ['DONE', 'FAILED', 'ABORTED'],
    states: {
      WAITING_FOR_HUMAN: {
        type: 'wait',
        description: '',
        transitions: [transition('WORK', 'human_approved')],
      },
      WORK: {
        type: 'action',
        description: '',
        entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        transitions: [transition('DONE', 'completion'), transition('FAILED', 'failure')],
      },
      DONE: { type: 'terminal', description: '', transitions: [] },
      FAILED: { type: 'terminal', description: '', transitions: [] },
      ABORTED: { type: 'terminal', description: '', transitions: [] },
    },
  };
  const timestamp = new Date().toISOString();
  const failed = mode === 'seed-failed';
  await persistence.save({
    runId: id,
    schemaVersion: 1,
    workflowName: 'ownership',
    workflowVersion: '1',
    currentState: failed ? 'FAILED' : 'WAITING_FOR_HUMAN',
    previousState: 'WORK',
    stateEnteredAt: timestamp,
    transitionCount: 1,
    stateHistory: ['WORK', failed ? 'FAILED' : 'WAITING_FOR_HUMAN'],
    iterationCounts: {},
    activeArtifacts: [],
    lastProducedArtifact: null,
    persistedAt: timestamp,
    persistenceVersion: 1,
    checksum: '',
    repoRoot: root,
    cumulativeInputTokens: 10,
    cumulativeOutputTokens: 5,
    hasReceivedUsage: true,
    ...(failed
      ? {}
      : {
          waitingContext: {
            reason: 'approval',
            requiredInput: 'approval',
            requestingState: 'WAITING_FOR_HUMAN',
            autoResumeSafe: false,
            presentedArtifacts: [],
            waitingSince: timestamp,
          },
        }),
  });
  fs.writeFileSync(join(runDir, 'workflow-definition.json'), JSON.stringify(definition));
  send('result', { state: persistence.load(id) });
} else if (['lock', 'lock-crash', 'publish-crash', 'reclaim-crash'].includes(mode)) {
  send('ready');
  await next();
  try {
    const handle = persistence.acquireLock(id);
    if (mode === 'lock-crash') process.exit(73);
    send('owned', { handle });
    await next();
    persistence.releaseLock(handle);
    send('result', { success: true });
  } catch (error) {
    send('result', { success: false, error: String(error) });
  }
} else {
  const { DefaultRunnerSystem } = await import('@ai-dev-orchestrator/runner');
  const dispatch = DefaultRunnerSystem.prototype.dispatch;
  DefaultRunnerSystem.prototype.dispatch = async function (...args) {
    fs.appendFileSync(join(root, 'dispatches.log'), 'dispatch\n');
    send('dispatch');
    await next();
    return dispatch.apply(this, args);
  };
  const { resumeOrchestrator } = await import('../../src/composition-root.ts');
  const context = await resumeOrchestrator(root, id);
  send('ready');
  await next();
  try {
    const result =
      mode === 'retry'
        ? await context.engine.retry()
        : mode === 'engine-abort'
          ? await context.engine.abort('Concurrent abort')
          : await context.engine.resume({ type: 'approval', content: 'Approved' });
    send('result', {
      success: true,
      finalState: result?.finalState ?? context.engine.getState().currentState,
      details:
        result?.finalState === 'FAILED'
          ? fs.readFileSync(join(runDir, 'journal.md'), 'utf8')
          : undefined,
    });
  } catch (error) {
    send('result', { success: false, error: String(error) });
  } finally {
    context.shutdownCoordinator?.uninstall();
  }
}
process.disconnect();
