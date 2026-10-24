import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexCliAdapter } from '@ai-dev-orchestrator/agent-adapters';
import {
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-dev-orchestrator/artifacts';
import { DefaultStatePersistence, InMemoryEventBus } from '@ai-dev-orchestrator/core';
import {
  DefaultGovernanceEngine,
  DefaultIterationContractRegistry,
} from '@ai-dev-orchestrator/governance';
import { DefaultJournalReader, DefaultJournalWriter } from '@ai-dev-orchestrator/journal';
import {
  DefaultPromptEngine,
  DefaultTemplateRegistry,
  DefaultTokenEstimator,
} from '@ai-dev-orchestrator/prompt-engine';
import { DefaultRoleRegistry } from '@ai-dev-orchestrator/role-system';
import { DefaultManifestProducer } from '@ai-dev-orchestrator/run-manifest';
import { CliAgentRunner, DefaultRunnerSystem } from '@ai-dev-orchestrator/runner';
import { LifecycleController } from '@ai-dev-orchestrator/workflow';

const [mode, root] = process.argv.slice(2);
const runId = 'fresh-process';
const runDir = join(root, runId);
const humanWait = mode.endsWith('-wait');
const journalPath = join(runDir, 'journal.md');
const plan = JSON.stringify({
  version: 1,
  specificationRef: { type: 'canonical_specification', name: 'input', version: 1 },
  createdAt: '2026-10-23T00:00:00Z',
  summary: 'Process recovery plan',
  tasks: [{ taskId: 'task-1', description: 'Recover', files: [], dependencies: [] }],
});

if (mode === 'agent') {
  appendFileSync(join(root, 'dispatches.log'), 'dispatch\n');
  process.stdout.write(
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: plan } }) + '\n',
  );
  process.stdout.write(
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 20 } }) +
      '\n',
  );
  process.exit(0);
}

mkdirSync(runDir, { recursive: true });
const events = new DefaultJournalReader(journalPath).readAll();
const persistence = new DefaultStatePersistence(root);
const journal = new DefaultJournalWriter(
  journalPath,
  runId,
  Math.max(0, ...events.map((event) => event.sequence)),
);
const artifacts = new FilesystemArtifactStore(
  runDir,
  runId,
  new DefaultOwnershipRegistry(),
  new DefaultArtifactTypeValidator(),
);
const roles = new DefaultRoleRegistry(
  [
    {
      id: 'planner',
      name: 'Planner',
      description: 'Deterministic process fixture',
      ownedArtifacts: ['plan'],
      readableArtifacts: [],
      forbiddenArtifacts: [],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: [],
      dispatchType: 'agent',
      runner: 'fixture',
      agentConfig: {},
    },
  ],
  { assignments: {}, defaultAssignment: { model: 'fixture', maxTokens: 4096 } },
);
const templates = new DefaultTemplateRegistry();
templates.register({
  frontmatter: {
    role: 'planner',
    version: '1',
    description: 'Fixture planner',
    variables: [],
    outputContract: {
      role: 'planner',
      artifactType: 'plan',
      schema: {},
      format: 'json',
      required: true,
      repairEnabled: false,
      maxRepairAttempts: 0,
    },
  },
  body: 'Produce a plan.',
  source: 'fixture.md',
});
const codex = new CodexCliAdapter();
const adapter = {
  name: codex.name,
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), 'agent', root],
  supportsProtocolHandshake: false,
  translateOutput: (line) => codex.translateOutput(line),
  translateInput: (message) => codex.translateInput(message),
};
const runner = new DefaultRunnerSystem(
  artifacts,
  roles,
  new DefaultPromptEngine(templates, new DefaultTokenEstimator()),
  new InMemoryEventBus({ runId }),
  {
    repoRoot: root,
    runDir,
    journalWriter: journal,
    runnerRegistry: new Map([
      ['fixture', new CliAgentRunner({ command: process.execPath, adapter })],
    ]),
  },
);
const contracts = new DefaultIterationContractRegistry();
const controller = new LifecycleController({
  runner,
  artifactStore: artifacts,
  roleRegistry: roles,
  statePersistence: persistence,
  journalWriter: journal,
  contractRegistry: contracts,
  governanceEngine: new DefaultGovernanceEngine(contracts),
  manifestProducer: new DefaultManifestProducer(),
});
const definition = {
  name: 'fresh-process',
  version: '1',
  initialState: 'WORK',
  terminalStates: ['DONE'],
  states: {
    WORK: {
      type: 'action',
      description: '',
      entryActions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
      transitions: [
        {
          target: humanWait ? 'WAITING_FOR_HUMAN' : 'DONE',
          trigger: 'completion',
          guards: [],
          governanceRequired: true,
          priority: 0,
        },
      ],
    },
    WAITING_FOR_HUMAN: {
      type: 'wait',
      description: 'Human gate',
      transitions: [
        {
          target: 'DONE',
          trigger: 'human_approved',
          guards: [],
          governanceRequired: false,
          priority: 0,
        },
      ],
    },
    DONE: {
      type: 'terminal',
      description: '',
      transitions: [],
      entryActions: ['first', 'second'].map((name) => ({
        type: 'store_artifact',
        params: { type: 'plan', name, content: plan },
      })),
    },
  },
};
const config = {
  runId,
  runDir,
  repoRoot: root,
  workflowDefinition: definition,
  governancePolicy: {},
  roleAssignments: {},
  sources: ['Verify fresh-process recovery'],
};
if (mode === 'crash') {
  const save = persistence.save.bind(persistence);
  persistence.save = async (state) => {
    if (state.pendingTerminalState && state.entryActionContinuation?.nextActionIndex === 1) {
      // The journal cursor has been fsynced, but its checkpoint file is still behind.
      writeFileSync(join(root, 'crashed-pid'), String(process.pid));
      process.exit(73);
    }
    await save(state);
  };
}
if (mode === 'resume' || mode === 'resume-wait') {
  const state = persistence.reconstructFromJournal(runId, events);
  if (
    mode === 'resume' &&
    (!state?.pendingTerminalState || state.entryActionContinuation?.nextActionIndex !== 1)
  ) {
    throw new Error('Expected a durable first-cleanup cursor');
  }
  if (mode === 'resume-wait' && state?.waitingContext?.requestingState !== 'WORK') {
    throw new Error('Expected the original human gate requester');
  }
  controller.restore(config, state);
}
let result =
  mode === 'resume'
    ? await controller.retry()
    : mode === 'resume-wait'
      ? await controller.resume({ type: 'approval', content: 'Approved' })
      : await controller.start(config);
if (mode === 'complete-wait') {
  result = await controller.resume({ type: 'approval', content: 'Approved' });
}
const state = persistence.load(runId);
const refs = await artifacts.list({});
const integrity = await Promise.all(refs.map((ref) => artifacts.verify(ref)));
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    finalState: result.finalState,
    refs,
    inputTokens: state.cumulativeInputTokens,
    outputTokens: state.cumulativeOutputTokens,
    stateHistory: state.stateHistory,
    pendingTerminalState: state.pendingTerminalState,
    waitingContext: state.waitingContext,
    repoRoot: state.repoRoot,
    lock: persistence.probeLock(runId),
    integrity: integrity.map((entry) => entry.valid),
    dispatches: readFileSync(join(root, 'dispatches.log'), 'utf8').trim().split('\n').length,
  }) + '\n',
);
