import { mkdirSync, writeFileSync } from 'node:fs';
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
  const { buildDataSources } = await import('../../src/dashboard/data-sources.ts');
  const runsDir = join(root, '.ai', 'runs');
  const persistence = new DefaultStatePersistence(runsDir);
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
  const server = new DashboardHttpServer({
    config: { port: 0, host: '127.0.0.1', runsDir },
    dataProvider: new DefaultDashboardDataProvider(buildDataSources()),
    eventStream: new SseEventStream(),
    actionHandler: new DefaultDashboardActionHandler(),
  });
  await server.start();
  process.stdout.write(JSON.stringify({ port: server.getPort() }) + '\n');
  process.on('SIGTERM', () => {
    void server.stop().then(() => process.exit(0));
  });
} else {
  throw new Error(`Unexpected fixture command: ${command}`);
}
