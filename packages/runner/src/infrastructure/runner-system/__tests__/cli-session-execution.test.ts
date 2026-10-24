import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliProcessRegistry } from '../cli-process-registry';
import { createCliSession } from '../cli-session-execution';

describe('CLI session creation', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cli-session-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function task(): AgentTask {
    return {
      taskId: 'task',
      runId: 'run',
      stateId: 'WORK',
      role: 'planner',
      description: '',
      inputArtifacts: [],
      repoRoot: root,
      runDir: root,
      outputArtifactPath: join(root, 'output.json'),
      constraints: { timeout: 1000, requiredOutputType: 'plan' },
    };
  }

  it('routes non-protocol adapters directly to ordinary dispatch without opening a process', async () => {
    const result = { taskId: 'task', status: 'success' as const, durationMs: 0 };
    const dispatchFallback = vi.fn().mockResolvedValue(result);
    const getSupervisor = vi.fn();
    expect(
      await createCliSession(task(), {
        config: {
          command: 'must-not-launch',
          adapter: {
            name: 'custom',
            command: 'must-not-launch',
            args: [],
            supportsProtocolHandshake: false,
          },
        },
        processes: new CliProcessRegistry(),
        getSupervisor,
        dispatchFallback,
      }),
    ).toEqual({ kind: 'terminal', result });
    expect(dispatchFallback).toHaveBeenCalledTimes(1);
    expect(getSupervisor).not.toHaveBeenCalled();
  });

  it('does not launch or fall back after cancellation during task-file preparation', async () => {
    const processes = new CliProcessRegistry();
    const dispatchFallback = vi.fn();
    const pending = createCliSession(task(), {
      config: { command: 'must-not-launch' },
      processes,
      getSupervisor: () => undefined,
      dispatchFallback,
    });
    processes.killAll();
    expect(await pending).toMatchObject({
      kind: 'terminal',
      result: { status: 'failure', error: 'Agent dispatch cancelled' },
    });
    expect(dispatchFallback).not.toHaveBeenCalled();
  });
});
