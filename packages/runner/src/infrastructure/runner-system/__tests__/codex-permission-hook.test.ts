import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentTask } from '@ai-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCodexPermissionHookAllowResponse,
  buildCodexPermissionHookArgs,
  buildCodexPermissionHookConfigArg,
  CODEX_HOOK_CONTEXT_FILENAME,
  CODEX_HOOK_SCRIPT_FILENAME,
  handleCodexPermissionHook,
  mapCodexHookInputToPermissionRequest,
  writeCodexPermissionHookArtifacts,
} from '../codex-permission-hook';

describe('mapCodexHookInputToPermissionRequest', () => {
  it('maps apply_patch writes to file_write permission requests', () => {
    const payload = mapCodexHookInputToPermissionRequest({
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Add File: /Users/me/.ai/runs/run-1/artifacts/out.json',
      },
    });

    expect(payload.action).toBe('file_write');
    expect(payload.resource).toContain('/.ai/runs/');
    expect(payload.riskLevel).toBe('medium');
  });

  it('maps bash escalation requests to shell_execute', () => {
    const payload = mapCodexHookInputToPermissionRequest({
      tool_name: 'Bash',
      tool_input: {
        command: 'cp /tmp/a.txt /Users/me/.ai/runs/run-1/artifacts/a.txt',
        description: 'Copy generated artifact',
      },
    });

    expect(payload.action).toBe('shell_execute');
    expect(payload.detail).toContain('Copy generated artifact');
    expect(payload.riskLevel).toBe('high');
  });
});

describe('buildCodexPermissionHookConfigArg', () => {
  it('escapes hook command paths for Codex -c overrides', () => {
    const arg = buildCodexPermissionHookConfigArg('/tmp/my hook.sh');
    expect(arg).toContain('hooks.PermissionRequest');
    expect(arg).toContain('matcher=".*"');
    expect(arg).toContain('timeout=600');
    expect(arg).toContain('command="/tmp/my hook.sh"');
  });
});

describe('buildCodexPermissionHookArgs', () => {
  it('includes hook trust bypass and config override', () => {
    expect(buildCodexPermissionHookArgs('/tmp/hook.sh')).toEqual([
      '--dangerously-bypass-hook-trust',
      '-c',
      buildCodexPermissionHookConfigArg('/tmp/hook.sh'),
    ]);
  });
});

describe('handleCodexPermissionHook', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(
      tmpdir(),
      `codex-hook-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  function makeContext(overrides: Record<string, unknown> = {}) {
    const runId = 'run-hook-test';
    const runDir = join(baseDir, 'runs', runId);
    return {
      runId,
      stateId: 'INTAKE',
      role: 'context_analyst',
      repoRoot: join(baseDir, 'repo'),
      runDir,
      runsDir: join(baseDir, 'runs'),
      dispatchId: 'codex-task-1',
      liveRequestTimeoutMs: 2_000,
      permissionPolicyConfig: { defaultAction: 'ask_human' as const },
      cliEntryPath: join(baseDir, 'ai', 'index.js'),
      nodeExecutable: process.execPath,
      ...overrides,
    };
  }

  async function writeContext(context: Record<string, unknown>): Promise<string> {
    const contextPath = join(context.runDir as string, CODEX_HOOK_CONTEXT_FILENAME);
    await mkdir(context.runDir as string, { recursive: true });
    await writeFile(contextPath, JSON.stringify(context));
    return contextPath;
  }

  it('auto-grants writes under ~/.ai via permission policy', async () => {
    const contextPath = await writeContext(makeContext());
    const stdin = JSON.stringify({
      tool_name: 'apply_patch',
      tool_input: {
        command: 'write /Users/test/.ai/runs/run-hook-test/artifacts/spec.json',
      },
    });

    const response = await handleCodexPermissionHook(contextPath, stdin);
    expect(JSON.parse(response)).toEqual(JSON.parse(buildCodexPermissionHookAllowResponse()));

    const stream = await readFile(
      join(baseDir, 'runs', 'run-hook-test', 'agent-stream.jsonl'),
      'utf-8',
    );
    expect(stream).toContain('permission_resolved');
    expect(stream).toContain('granted');
    expect(stream).toContain('"action":"file_write"');
    expect(stream).toContain('spec.json');
  });

  it('creates a live request and waits for dashboard approval', async () => {
    const context = makeContext();
    const contextPath = await writeContext(context);
    const stdin = JSON.stringify({
      tool_name: 'Bash',
      tool_input: {
        command: 'npm install left-pad',
        description: 'Install dependency',
      },
    });

    const pending = handleCodexPermissionHook(contextPath, stdin);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const requestsDir = join(baseDir, 'runs', 'run-hook-test', 'live-requests');
    const requestFiles = await readDirJsonFiles(requestsDir);
    expect(requestFiles).toHaveLength(1);
    const messageId = requestFiles[0]?.messageId;
    if (!messageId) {
      throw new Error('expected live request messageId');
    }

    const responsesDir = join(baseDir, 'runs', 'run-hook-test', 'live-responses');
    await mkdir(responsesDir, { recursive: true });
    await writeFile(
      join(responsesDir, `${messageId}.json`),
      JSON.stringify({
        runId: 'run-hook-test',
        messageId,
        respondedAt: new Date().toISOString(),
        payload: { granted: true },
      }),
    );

    const response = await pending;
    expect(JSON.parse(response)).toEqual(JSON.parse(buildCodexPermissionHookAllowResponse()));
  });

  it('denies when the live request times out', async () => {
    const contextPath = await writeContext(
      makeContext({
        liveRequestTimeoutMs: 200,
      }),
    );
    const stdin = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const response = await handleCodexPermissionHook(contextPath, stdin);
    const parsed = JSON.parse(response) as {
      hookSpecificOutput: { decision: { behavior: string; message?: string } };
    };
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(parsed.hookSpecificOutput.decision.message).toContain('timed out');
  });
});

describe('writeCodexPermissionHookArtifacts', () => {
  it('writes hook context and launcher script for codex exec', async () => {
    const runDir = join(tmpdir(), `codex-artifacts-${String(Date.now())}`);
    const task = {
      taskId: 'worker-000001',
      runId: 'run-1',
      stateId: 'INTAKE',
      role: 'context_analyst',
      repoRoot: '/repo',
      runDir,
      outputArtifactPath: `${runDir}/artifacts/out.json`,
      constraints: { timeout: 60_000, requiredOutputType: 'canonical_specification' },
    } as AgentTask;

    const { hookCommand, contextPath } = await writeCodexPermissionHookArtifacts(
      task,
      {
        runsDir: join(runDir, '..'),
        cliEntryPath: '/usr/local/lib/ai/index.js',
      },
      { defaultAction: 'ask_human' },
    );

    expect(hookCommand).toBe(join(runDir, CODEX_HOOK_SCRIPT_FILENAME));
    expect(contextPath).toBe(join(runDir, CODEX_HOOK_CONTEXT_FILENAME));

    const script = await readFile(hookCommand, 'utf-8');
    expect(script).toContain('codex-permission-hook');
    expect(script).toContain('/usr/local/lib/ai/index.js');

    await rm(runDir, { recursive: true, force: true });
  });
});

async function readDirJsonFiles(dir: string): Promise<Array<{ messageId?: string }>> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  const results: Array<{ messageId?: string }> = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const content = await readFile(join(dir, file), 'utf-8');
    results.push(JSON.parse(content) as { messageId?: string });
  }
  return results;
}
