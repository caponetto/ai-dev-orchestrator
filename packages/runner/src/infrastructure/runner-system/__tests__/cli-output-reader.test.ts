import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractArtifactJsonFromAgentText, readCliOutput } from '../cli-output-reader';

describe('CLI output reading', () => {
  it('rejects malformed JSON emitted in agent text', () => {
    expect(extractArtifactJsonFromAgentText('{broken')).toBeNull();
  });
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cli-output-'));
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

  it('fails after invalid file and fallback output while preserving accumulated usage', async () => {
    const current = task();
    await writeFile(current.outputArtifactPath, '{invalid');
    const stream = vi.fn();
    expect(
      await readCliOutput(
        current,
        Date.now(),
        { inputTokens: 30, outputTokens: 20 },
        stream,
        '{also invalid',
      ),
    ).toMatchObject({ status: 'failure', tokenUsage: { inputTokens: 30, outputTokens: 20 } });
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ type: 'stderr' }));
  });

  it('retains stream usage when the written artifact reports no usage', async () => {
    const current = task();
    await writeFile(
      current.outputArtifactPath,
      '{"summary":"done","tokenUsage":{"inputTokens":0,"outputTokens":0}}',
    );
    expect(
      await readCliOutput(current, Date.now(), { inputTokens: 30, outputTokens: 20 }),
    ).toMatchObject({
      taskId: 'task',
      status: 'success',
      tokenUsage: { inputTokens: 30, outputTokens: 20 },
    });
  });

  it('uses usage from the last concatenated JSON object and preserves the original content', async () => {
    const current = task();
    const content =
      '{"summary":"partial"}\n{"summary":"done","tokenUsage":{"inputTokens":7,"outputTokens":3}}';
    await writeFile(current.outputArtifactPath, content);
    expect(
      await readCliOutput(current, Date.now(), { inputTokens: 30, outputTokens: 20 }),
    ).toMatchObject({
      status: 'success',
      artifactContent: content,
      tokenUsage: { inputTokens: 7, outputTokens: 3 },
    });
  });
});
