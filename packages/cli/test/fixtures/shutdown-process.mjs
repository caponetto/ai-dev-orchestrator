import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [root, mode] = process.argv.slice(2);
if (!root || !mode) throw new Error('Temporary root and scenario required');
if (mode === 'agent-stubborn') {
  process.on('SIGTERM', () => {});
  writeFileSync(join(root, 'worker.pid'), String(process.pid));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else {
  os.homedir = () => root;
  syncBuiltinESMExports();
  process.chdir(root);
  process.env.AI_ORCHESTRATOR_FIXTURE = '1';
  process.env.NO_COLOR = '1';
  const { LifecycleController } = await import('@ai-dev-orchestrator/workflow');
  const { DefaultRunnerSystem, CliAgentRunner, FileBackedLiveRequestStore } =
    await import('@ai-dev-orchestrator/runner');
  const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
  const { DefaultJournalReader } = await import('@ai-dev-orchestrator/journal');
  if (!existsSync(join(root, '.ai', 'roles.yaml'))) {
    const { generateAll } = await import('@ai-dev-orchestrator/config-templates');
    const { mkdirSync } = await import('node:fs');
    for (const [name, content] of generateAll()) {
      const path = join(root, '.ai', name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    }
    writeFileSync(
      join(root, '.ai', 'templates', 'planner.md'),
      [
        '---',
        'role: planner',
        'version: 1.0.0',
        'description: Shutdown fixture',
        'variables: []',
        'output_contract:',
        '  role: planner',
        '  artifact_type: plan',
        '  format: json',
        '  required: true',
        '  repair_enabled: false',
        '  max_repair_attempts: 0',
        '---',
        'Produce a deterministic plan.',
      ].join('\n'),
    );
  }
  const runsDir = join(root, '.ai', 'runs');
  const idPath = join(root, 'run-id');
  const plan = {
    name: 'shutdown',
    version: '1',
    initialState: 'WORK',
    terminalStates: ['DONE', 'FAILED', 'ABORTED'],
    states: {
      WORK: {
        type: 'action',
        description: '',
        entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
        transitions: [
          {
            target: 'DONE',
            trigger: 'completion',
            guards: [],
            priority: 0,
            governanceRequired: false,
          },
        ],
      },
      WAITING_FOR_HUMAN: { type: 'wait', description: '', transitions: [] },
      DONE: { type: 'terminal', description: '', transitions: [] },
      FAILED: { type: 'terminal', description: '', transitions: [] },
      ABORTED: { type: 'terminal', description: '', transitions: [] },
    },
  };
  if (mode === 'inspect') {
    const id = readFileSync(idPath, 'utf8');
    const persistence = new DefaultStatePersistence(runsDir);
    const { loadLatestRunState } = await import('../../src/run-state-recovery.ts');
    const { getJournalPath } = await import('../../src/workspace-paths.ts');
    const events = new DefaultJournalReader(getJournalPath(join(runsDir, id))).readAll();
    const latest = loadLatestRunState(persistence, id, events).state;
    process.stdout.write(
      'INSPECT:' +
        JSON.stringify({
          state: latest?.currentState,
          waitingContext: latest?.waitingContext,
          lock: persistence.probeLock(id),
          checkpoints: events
            .filter((e) => e.type === 'workflow_checkpoint')
            .map((e) => e.data.state.currentState),
        }) +
        '\n',
    );
  } else {
    if (mode.startsWith('run-') || mode === 'seed-session') {
      const original = LifecycleController.prototype.start;
      LifecycleController.prototype.start = async function (config) {
        config = { ...config, workflowDefinition: plan };
        writeFileSync(idPath, config.runId);
        writeFileSync(join(config.runDir, 'workflow-definition.json'), JSON.stringify(plan));
        const failure = {
          workerId: 'test-worker',
          role: 'planner',
          status: 'failure',
          outputArtifacts: [],
          metrics: {
            startedAt: '',
            completedAt: '',
            durationMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            retryCount: 0,
            modelUsed: 'test',
          },
        };
        if (mode === 'run-stubborn') {
          const runner = new CliAgentRunner({
            command: process.execPath,
            args: [fileURLToPath(import.meta.url), root, 'agent-stubborn'],
            handshakeTimeoutMs: 25,
          });
          this.runner.runnerRegistry.set('fixture', {
            dispatch: (task, stream) =>
              runner.dispatch(
                {
                  ...task,
                  agentConfig: {
                    ...task.agentConfig,
                    command: process.execPath,
                    args: [fileURLToPath(import.meta.url), root, 'agent-stubborn'],
                  },
                },
                stream,
              ),
            killAll: () => runner.killAll(),
          });
        } else if (mode === 'seed-session') {
          this.runner.dispatch = async () => ({
            ...failure,
            status: 'success',
            sessionOutcome: 'awaiting_human',
            sessionRef: {
              runId: config.runId,
              sessionId: 'session',
              stateId: 'WORK',
              role: 'planner',
              transport: 'remote',
            },
            pendingRequest: {
              requestId: 'request',
              kind: 'permission',
              createdAt: '',
              payload: {},
            },
          });
        } else {
          let settle;
          this.runner.dispatch = () => {
            writeFileSync(join(root, 'dispatched'), 'ready');
            return new Promise((resolve) => {
              settle = resolve;
            });
          };
          this.runner.cancelAllWorkers = () => {
            appendFileSync(join(root, 'cancellations'), 'cancel\n');
            if (mode === 'run-hung') return new Promise(() => {});
            settle?.(failure);
            return Promise.resolve();
          };
          if (['run-permission', 'run-clarification', 'run-write'].includes(mode)) {
            const store = new FileBackedLiveRequestStore(runsDir);
            await store.writeRequest({
              runId: config.runId,
              messageId: 'request',
              kind: mode === 'run-clarification' ? 'clarification' : 'permission',
              createdAt: '',
              payload: {
                action: 'write',
                resource: 'file',
                riskLevel: 'low',
                question: 'Which database?',
              },
            });
          }
        }
        return original.call(this, config);
      };
    }
    if (mode === 'run-write') {
      const write = FileBackedLiveRequestStore.prototype.writeResponse;
      FileBackedLiveRequestStore.prototype.writeResponse = async function (...args) {
        writeFileSync(join(root, 'writing'), 'started');
        const deadline = Date.now() + 5000;
        while (!existsSync(join(root, 'release-write'))) {
          if (Date.now() > deadline) throw new Error('Fixture write barrier timed out');
          await setTimeout(20);
        }
        return write.apply(this, args);
      };
    }
    if (mode === 'resume-session') {
      const restore = LifecycleController.prototype.restore;
      LifecycleController.prototype.restore = function (...args) {
        restore.apply(this, args);
        const id = readFileSync(idPath, 'utf8');
        let advance;
        let keepalive;
        this.sessionSupervisor = {
          attach: async () => ({
            ref: {
              runId: id,
              sessionId: 'session',
              stateId: 'WORK',
              role: 'planner',
              transport: 'remote',
            },
            state: 'awaiting_human',
            pendingRequests: [
              { requestId: 'request', kind: 'permission', createdAt: '', payload: {} },
            ],
          }),
          sendHumanResponse: async () => true,
          waitForAdvance: () => {
            writeFileSync(join(root, 'advancing'), 'ready');
            keepalive = setInterval(() => {}, 1000);
            return new Promise((resolve) => {
              advance = resolve;
            });
          },
          listByRun: async () => [{ ref: { runId: id, sessionId: 'session' }, state: 'running' }],
          abort: async () => {
            appendFileSync(join(root, 'session-cancellations'), 'abort\n');
            clearInterval(keepalive);
            advance?.({ kind: 'failed', error: 'shutdown' });
            return true;
          },
        };
      };
    }
    const id = existsSync(idPath) ? readFileSync(idPath, 'utf8') : '';
    const entry = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
    process.argv = [
      process.execPath,
      entry,
      ...(mode === 'recover'
        ? ['retry', id, '--json']
        : mode === 'resume-session'
          ? ['permit', id, '--message-id', 'request', '--json']
          : [
              'run',
              'Shutdown regression',
              ...(['run-permission', 'run-clarification', 'run-write'].includes(mode)
                ? []
                : ['--json']),
            ]),
    ];
    process.once('beforeExit', () => {
      if (process.exitCode && process.exitCode !== 4 && existsSync(idPath)) {
        const journal = join(runsDir, readFileSync(idPath, 'utf8'), 'journal.md');
        if (existsSync(journal)) process.stderr.write(readFileSync(journal, 'utf8'));
      }
    });
    await import('../../src/index.ts');
  }
}
