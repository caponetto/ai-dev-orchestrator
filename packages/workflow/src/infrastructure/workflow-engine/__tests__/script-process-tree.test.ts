/* eslint-disable @typescript-eslint/unbound-method -- Assert mock port calls without invoking unbound methods. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorkflowRunConfig } from '@ai-dev-orchestrator/schemas';
import {
  createMockArtifactStore,
  createMockContractRegistry,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '@ai-dev-orchestrator/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';
import { ScriptExecutor } from '../script-executor';

const fixture = fileURLToPath(
  new URL('../../../../../utils/test/fixtures/process-tree.mjs', import.meta.url),
);
const roots: string[] = [];
function running(pid: number) {
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
      .trim()
      .startsWith('Z');
  } catch {
    return false;
  }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (existsSync(join(root, 'parent.pid'))) {
      try {
        process.kill(-Number(readFileSync(join(root, 'parent.pid'), 'utf8')), 'SIGKILL');
      } catch {
        /* Owned group exited. */
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});
describe.skipIf(process.platform === 'win32')('workflow script process ownership', () => {
  it.each(['timeout', 'parent-exit', 'parent-exit-closed-pipes'])(
    'settles scripts and descendants after %s',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'script-tree-'));
      roots.push(root);
      await copyFile(fixture, join(root, 'tree.ts'));
      const executor = new ScriptExecutor({
        journalWriter: createMockJournalWriter(),
        globalScriptsDir: root,
      });
      const result = await executor.execute(
        {
          script: 'tree.ts',
          timeout: mode === 'timeout' ? 1000 : 15000,
          env: {
            TREE_ROOT: root,
            TREE_PARENT_EXIT: mode === 'timeout' ? '0' : '1',
            TREE_CLOSED_PIPES: mode === 'parent-exit-closed-pipes' ? '1' : '0',
          },
        },
        { runId: 'tree', stateId: 'WORK', repoRoot: root, artifactsDir: root, dispatchId: 'tree' },
      );
      expect(result.success).toBe(mode !== 'timeout');
      if (mode === 'timeout') {
        expect(result.error).toContain('Script timed out');
      }
      await vi.waitFor(() => {
        for (const name of ['parent.pid', 'leaf.pid']) {
          expect(running(Number(readFileSync(join(root, name), 'utf8')))).toBe(false);
        }
      });
    },
    18000,
  );
  it('aborts a stubborn script and its descendant before releasing the workflow lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'script-tree-'));
    roots.push(root);
    const scripts = join(root, 'scripts');
    await mkdir(scripts);
    await copyFile(fixture, join(scripts, 'tree.ts'));
    const store = createMockArtifactStore();
    const persistence = createMockStatePersistence();
    const controller = new LifecycleController({
      artifactStore: store,
      statePersistence: persistence,
      runner: createMockRunnerSystem(),
      journalWriter: createMockJournalWriter(),
      contractRegistry: createMockContractRegistry(),
      governanceEngine: createMockGovernance(),
      manifestProducer: createMockManifestProducer(),
    });
    // Point the script directory at the disposable fixture without changing production lookup rules.
    const dispatcher = controller as unknown as {
      dispatcher: { scriptExecutor: { globalScriptsDir: string } };
    };
    dispatcher.dispatcher.scriptExecutor.globalScriptsDir = scripts;
    const config: WorkflowRunConfig = {
      runId: 'script-tree',
      sources: [],
      governancePolicy: {},
      roleAssignments: {},
      workflowDefinition: {
        name: 'script-tree',
        version: '1',
        initialState: 'WORK',
        terminalStates: ['DONE', 'ABORTED'],
        states: {
          WORK: {
            type: 'action',
            description: '',
            entryActions: [
              {
                type: 'run_script',
                params: { script: 'tree.ts', timeout: 30000, env: { TREE_ROOT: root } },
              },
            ],
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
          DONE: { type: 'terminal', description: '', transitions: [] },
          ABORTED: { type: 'terminal', description: '', transitions: [] },
        },
      },
    };
    const execution = controller.start(config);
    try {
      await vi.waitFor(
        () => {
          expect(existsSync(join(root, 'leaf.beat'))).toBe(true);
        },
        { timeout: 5000 },
      );
      const parent = Number(readFileSync(join(root, 'parent.pid'), 'utf8'));
      const leaf = Number(readFileSync(join(root, 'leaf.pid'), 'utf8'));
      const abort = controller.abort('test cancellation');
      expect(persistence.releaseLock).not.toHaveBeenCalled();
      await vi.waitFor(
        () => {
          expect(running(parent)).toBe(false);
          expect(running(leaf)).toBe(false);
        },
        { timeout: 6500, interval: 50 },
      );
      await abort;
      expect((await execution).finalState).toBe('ABORTED');
      expect(persistence.releaseLock).toHaveBeenCalledOnce();
    } finally {
      if (existsSync(join(root, 'parent.pid'))) {
        try {
          process.kill(-Number(readFileSync(join(root, 'parent.pid'), 'utf8')), 'SIGKILL');
        } catch {
          /* Group already stopped. */
        }
      }
      await execution;
    }
  }, 20000);
});
