import { mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [root, command, target, mode] = process.argv.slice(2);
if (!root || !command || !target)
  throw new Error('Temporary root, command and target are required');
os.homedir = () => root;
syncBuiltinESMExports();
process.env.AI_ORCHESTRATOR_FIXTURE = '1';
process.chdir(root);

const { DefaultStatePersistence } = await import('@ai-dev-orchestrator/core');
const runId = 'workflow-result';
const runDir = join(root, '.ai', 'runs', runId);
mkdirSync(runDir, { recursive: true });
const transition = (trigger) => ({
  target,
  trigger,
  guards: [],
  priority: 0,
  governanceRequired: false,
});
const definition = {
  name: 'workflow-result',
  version: '1',
  initialState: 'WORK',
  terminalStates: ['DONE', 'FAILED', 'ABORTED'],
  states: {
    WORK: { type: 'action', description: '', transitions: [transition('completion')] },
    WAITING_FOR_HUMAN: {
      type: 'wait',
      description: '',
      transitions: ['human_approved', 'human_rejected', 'human_input'].map(transition),
    },
    DONE: { type: 'terminal', description: '', transitions: [] },
    FAILED: { type: 'terminal', description: '', transitions: [] },
    ABORTED: { type: 'terminal', description: '', transitions: [] },
  },
};
writeFileSync(join(runDir, 'workflow-definition.json'), JSON.stringify(definition));
writeFileSync(join(runDir, 'sources.json'), JSON.stringify(['Verify actual CLI exit status']));
const currentState = command === 'retry' ? 'FAILED' : 'WAITING_FOR_HUMAN';
const timestamp = new Date().toISOString();
await new DefaultStatePersistence(join(root, '.ai', 'runs')).save({
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
    command === 'retry'
      ? undefined
      : {
          reason: 'review_required',
          requiredInput: command === 'answer' ? 'text' : 'approval',
          requestingState: 'WORK',
          autoResumeSafe: false,
          presentedArtifacts: [],
          waitingSince: timestamp,
        },
});
const entry = fileURLToPath(
  new URL(mode === 'bundle' ? '../../dist/index.js' : '../../src/index.ts', import.meta.url),
);
process.argv = [
  process.execPath,
  entry,
  command === 'reject' ? 'approve' : command,
  runId,
  ...(command === 'reject' ? ['--reject'] : []),
  ...(command === 'answer' ? ['response'] : []),
  '--json',
];
await import(entry);
