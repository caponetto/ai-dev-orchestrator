import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import {
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-dev-orchestrator/artifacts';
import {
  DashboardHttpServer,
  DefaultDashboardDataProvider,
  SseEventStream,
} from '@ai-dev-orchestrator/dashboard-server';

import { FileBackedAgentStreamBus, FileBackedLiveRequestStore } from '@ai-dev-orchestrator/runner';

const [command, argument] = process.argv.slice(2);
const root = command === 'serve' ? argument : process.env.ORCHESTRATOR_TEST_ROOT;
if (!root) throw new Error('A temporary fixture root is required');
// Scope the real CLI's global configuration to this disposable process and its children.
os.homedir = () => root;
syncBuiltinESMExports();
process.env.ORCHESTRATOR_TEST_ROOT = root;
process.env.AI_ORCHESTRATOR_FIXTURE = '1';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${import.meta.resolve('tsx')}`;

const { OutputFormatter } = await import('../../src/output/formatter.ts');
if (command === 'approve') {
  const { approveCommand } = await import('../../src/commands/approve.ts');
  process.exitCode = await approveCommand(
    {
      runId: argument,
      reject: false,
      message: null,
      json: false,
      verbose: false,
    },
    new OutputFormatter({ noColor: true }),
  );
} else if (command === 'retry') {
  const { retryCommand } = await import('../../src/commands/retry.ts');
  process.exitCode = await retryCommand(
    root,
    {
      runId: argument,
      json: false,
      verbose: false,
    },
    new OutputFormatter({ noColor: true }),
  );
} else if (command === 'serve') {
  const { DefaultDashboardActionHandler } =
    await import('../../src/dashboard/default-dashboard-action-handler.ts');
  const { buildDataSources, startJournalPoller } =
    await import('../../src/dashboard/data-sources.ts');
  const runsDir = join(root, '.ai', 'runs');
  const persistence = new DefaultStatePersistence(runsDir);
  const ownedLocks = [];
  const definition = {
    name: 'browser-actions',
    version: '1',
    initialState: 'WORK',
    terminalStates: ['DONE', 'FAILED', 'ABORTED'],
    states: {
      WORK: {
        type: 'action',
        description: 'Produce a plan',
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
      WAITING_FOR_HUMAN: {
        type: 'wait',
        description: 'Approve the plan',
        transitions: [
          {
            target: 'WORK',
            trigger: 'human_approved',
            guards: [],
            priority: 0,
            governanceRequired: false,
          },
        ],
      },
      DONE: { type: 'terminal', description: '', transitions: [] },
      FAILED: { type: 'terminal', description: '', transitions: [] },
      ABORTED: { type: 'terminal', description: '', transitions: [] },
    },
  };
  for (const [runId, currentState] of [
    ['browser-approve', 'WAITING_FOR_HUMAN'],
    ['browser-abort', 'WORK'],
    ['browser-retry', 'FAILED'],
    ['browser-live', 'WORK'],
    ['browser-other', 'WORK'],
  ]) {
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'workflow-definition.json'), JSON.stringify(definition));
    writeFileSync(join(runDir, 'sources.json'), JSON.stringify(['Exercise real browser actions']));
    const timestamp = new Date().toISOString();
    await persistence.save({
      runId,
      schemaVersion: 2,
      currentState,
      previousState: 'WORK',
      repoRoot: root,
      stateEnteredAt: timestamp,
      transitionCount: 1,
      stateHistory: ['WORK', currentState],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: definition.name,
      workflowVersion: definition.version,
      persistedAt: timestamp,
      persistenceVersion: 1,
      checksum: '',
      waitingContext:
        currentState === 'WAITING_FOR_HUMAN'
          ? {
              reason: 'review_required',
              requiredInput: 'approval',
              requestingState: 'WORK',
              autoResumeSafe: false,
              presentedArtifacts: [],
              waitingSince: timestamp,
            }
          : undefined,
    });
    if (runId === 'browser-live' || runId === 'browser-other')
      ownedLocks.push(persistence.acquireLock(runId));
    await new FilesystemArtifactStore(
      runDir,
      runId,
      new DefaultOwnershipRegistry(),
      new DefaultArtifactTypeValidator(),
    ).store({
      type: 'canonical_specification',
      name: 'input',
      producedBy: 'requirements_analyst',
      content: JSON.stringify({
        id: 'browser-specification',
        version: 1,
        title: 'Browser integration',
        businessGoal: 'Verify production actions',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    });
  }
  const eventStream = new SseEventStream();
  const agentStreamBus = new FileBackedAgentStreamBus(runsDir);
  const liveRequestStore = new FileBackedLiveRequestStore(runsDir);
  const server = new DashboardHttpServer({
    config: { port: 0, host: '127.0.0.1', runsDir },
    dataProvider: new DefaultDashboardDataProvider(buildDataSources()),
    eventStream,
    agentStreamBus,
    liveRequestStore,
    actionHandler: new DefaultDashboardActionHandler(),
  });
  await server.start();
  const journalPoller = startJournalPoller(eventStream);
  // A transparent test proxy can sever actual SSE connections without altering server code.
  const streams = new Set();
  const sockets = new Set();
  const proxy = createServer((req, res) => {
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: server.getPort(),
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        res.flushHeaders();
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
    if (req.url.includes('agent-stream')) streams.add(res);
    res.on('close', () => {
      streams.delete(res);
      upstream.destroy();
    });
  });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  process.stdout.write(JSON.stringify({ port: proxy.address().port }) + '\n');
  // Test control travels over IPC, never through production HTTP routes.
  let sequence = 0;
  const publish = (runId, content, extra = {}) =>
    agentStreamBus.publish({
      runId,
      stateId: 'WORK',
      roleId: 'planner',
      dispatchId: `${runId}-worker`,
      timestamp: new Date(Date.now() + sequence++).toISOString(),
      type: 'stdout',
      content,
      ...extra,
    });
  process.on('message', async ({ id, operation, runId = 'browser-live', ...args }) => {
    try {
      let result = null;
      if (operation === 'disconnect-streams') {
        result = streams.size;
        for (const response of streams) response.destroy();
      } else if (operation === 'log') {
        publish(runId, args.content);
      } else if (operation === 'request') {
        const payload =
          args.kind === 'permission'
            ? {
                action: 'file_write',
                resource: '/src/browser.ts',
                riskLevel: 'low',
                detail: 'Browser test write',
              }
            : { question: 'Which color should the fixture use?', context: 'Choose a color' };
        await liveRequestStore.writeRequest({
          runId,
          messageId: args.messageId,
          kind: args.kind,
          createdAt: new Date().toISOString(),
          payload,
        });
        publish(runId, args.kind + ' request', {
          type: args.kind + '_request',
          requestMessageId: args.messageId,
          structuredData: { messageType: args.kind + '_request', ...payload },
        });
      } else if (operation === 'consume') {
        // A deterministic agent consumes the same durable response as a real runner.
        result = await liveRequestStore.awaitResponse(runId, args.messageId, 0);
        if (!result) throw new Error('No persisted response to consume');
        publish(runId, 'Response consumed', {
          requestMessageId: args.messageId,
          structuredData: { messageType: args.kind + '_response', ...result.payload },
        });
        publish(runId, 'Agent continued after ' + args.messageId);
      } else if (operation === 'read-response') {
        result = await liveRequestStore.awaitResponse(runId, args.messageId, 0);
      } else if (operation === 'fail-next-response') {
        const original = liveRequestStore.writeResponse.bind(liveRequestStore);
        liveRequestStore.writeResponse = async () => {
          liveRequestStore.writeResponse = original;
          throw new Error('Injected disk failure');
        };
      } else if (operation === 'expire') {
        const path = join(runsDir, runId, 'live-requests', args.messageId + '.json');
        const request = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(path, JSON.stringify({ ...request, expiresAt: '2020-01-01T00:00:00Z' }));
      } else if (operation === 'complete') {
        const state = persistence.load(runId);
        await persistence.save({ ...state, currentState: 'DONE', previousState: 'WORK' });
        publish(runId, 'Fixture completed', {
          structuredData: { messageType: 'done', summary: 'Fixture completed' },
        });
        eventStream.publish({
          type: 'state_changed',
          timestamp: new Date().toISOString(),
          runId,
          data: { from: 'WORK', to: 'DONE' },
        });
      } else {
        throw new Error('Unknown fixture operation: ' + operation);
      }
      process.send?.({ id, result });
    } catch (error) {
      process.send?.({ id, error: String(error) });
    }
  });
  process.on('SIGTERM', () => {
    for (const socket of sockets) socket.destroy();
    proxy.close();
    journalPoller.stop();
    agentStreamBus.dispose();
    for (const lock of ownedLocks) persistence.releaseLock(lock);
    void server.stop().then(() => process.exit(0));
  });
} else {
  throw new Error(`Unexpected fixture command: ${command}`);
}
