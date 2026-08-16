import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentStreamBus, JournalWriter } from '@ai-orchestrator/ports';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ScriptExecutor } from '../script-executor';

function makeJournalWriter(): JournalWriter {
  return { append: vi.fn() };
}

function makeStreamBus(): AgentStreamBus {
  return {
    subscribe: vi.fn().mockReturnValue('id'),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    getClientCount: vi.fn().mockReturnValue(0),
  };
}

describe('ScriptExecutor', () => {
  let tempDir: string;
  let scriptsDir: string;
  let repoRoot: string;
  let journalWriter: JournalWriter;
  let streamBus: AgentStreamBus;
  let executor: ScriptExecutor;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'script-executor-test-'));
    scriptsDir = join(tempDir, 'scripts');
    repoRoot = join(tempDir, 'repo');
    await mkdir(scriptsDir, { recursive: true });
    await mkdir(repoRoot, { recursive: true });

    journalWriter = makeJournalWriter();
    streamBus = makeStreamBus();
    executor = new ScriptExecutor({
      journalWriter,
      agentStreamBus: streamBus,
      globalScriptsDir: scriptsDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function context(overrides: Partial<Parameters<typeof executor.execute>[1]> = {}) {
    return {
      runId: 'run-1',
      stateId: 'PUBLISH_REVIEW',
      repoRoot,
      artifactsDir: join(tempDir, 'artifacts'),
      dispatchId: 'dispatch-1',
      ...overrides,
    };
  }

  async function writeScript(name: string, content: string, executable = true): Promise<string> {
    const path = join(scriptsDir, name);
    await writeFile(path, content, 'utf-8');
    if (executable) {
      await chmod(path, 0o755);
    }
    return path;
  }

  it('returns failure when script file does not exist', async () => {
    const result = await executor.execute({ script: 'nonexistent-script' }, context());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Script not found');
    expect(result.error).toContain('nonexistent-script');
    expect(result.error).toContain(scriptsDir);
  });

  it('returns failure when non-TS script is not executable', async () => {
    await writeScript('not-executable', '#!/bin/bash\necho hi', false);

    const result = await executor.execute({ script: 'not-executable' }, context());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Script not executable');
  });

  it('executes a successful script and returns scriptResult', async () => {
    await writeScript('hello', '#!/bin/bash\necho "hello world"');

    const result = await executor.execute({ script: 'hello' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult).toBeDefined();
    const sr = result.scriptResult;
    expect(sr?.exitCode).toBe(0);
    expect(sr?.stdout).toContain('hello world');
    expect(sr?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('executes TypeScript scripts via node without requiring +x', async () => {
    await writeScript(
      'hello.ts',
      'console.log("hello from ts");\n',
      false, // not executable
    );

    const result = await executor.execute({ script: 'hello.ts' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('hello from ts');
  });

  it('returns failure on non-zero exit code', async () => {
    await writeScript('fail', '#!/bin/bash\necho "error msg" >&2\nexit 42');

    const result = await executor.execute({ script: 'fail' }, context());

    expect(result.success).toBe(false);
    expect(result.scriptResult).toBeDefined();
    expect(result.scriptResult?.exitCode).toBe(42);
    expect(result.scriptResult?.stderr).toContain('error msg');
  });

  it('passes environment variables to the script', async () => {
    await writeScript('env-check', '#!/bin/bash\necho "$ORCHESTRATOR_RUN_ID:$CUSTOM_VAR"');

    const result = await executor.execute(
      { script: 'env-check', env: { CUSTOM_VAR: 'test-value' } },
      context({ runId: 'my-run-id' }),
    );

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('my-run-id:test-value');
  });

  it('kills script on timeout', async () => {
    await writeScript('slow', '#!/bin/bash\nsleep 60\necho done');

    const result = await executor.execute({ script: 'slow', timeout: 200 }, context());

    expect(result.success).toBe(false);
    expect(result.scriptResult).toBeDefined();
    expect(result.scriptResult?.stderr).toContain('Script timed out');
    expect(result.scriptResult?.durationMs).toBeLessThan(10000);
  }, 15000);

  it('records journal events for start and complete', async () => {
    await writeScript('journal-test', '#!/bin/bash\necho ok');

    await executor.execute({ script: 'journal-test' }, context());

    /* eslint-disable @typescript-eslint/unbound-method */
    expect(journalWriter.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'script_started' }),
    );
    expect(journalWriter.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'script_completed' }),
    );
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('emits stream events', async () => {
    await writeScript('stream-test', '#!/bin/bash\necho output');

    await executor.execute({ script: 'stream-test' }, context());

    /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
    expect(streamBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredData: expect.objectContaining({ messageType: 'script_started' }),
      }),
    );
    expect(streamBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredData: expect.objectContaining({ messageType: 'script_completed' }),
      }),
    );
    /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
  });

  it('captures both stdout and stderr', async () => {
    await writeScript('both-streams', '#!/bin/bash\necho "out"\necho "err" >&2');

    const result = await executor.execute({ script: 'both-streams' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('out');
    expect(result.scriptResult?.stderr).toContain('err');
  });

  it('runs script with cwd set to repoRoot', async () => {
    await writeScript('cwd-test', '#!/bin/bash\npwd');

    const result = await executor.execute({ script: 'cwd-test' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout.trim()).toContain('script-executor-test-');
  });

  it('uses fallback error message when script exits non-zero with empty stderr', async () => {
    await writeScript('silent-fail', '#!/bin/bash\nexit 7');

    const result = await executor.execute({ script: 'silent-fail' }, context());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Script exited with code 7');
  });

  it('works without agentStreamBus (no stream events emitted)', async () => {
    const executorNoStream = new ScriptExecutor({
      journalWriter: makeJournalWriter(),
      globalScriptsDir: scriptsDir,
    });

    await writeScript('no-stream', '#!/bin/bash\necho "hello"');

    const result = await executorNoStream.execute({ script: 'no-stream' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('hello');
  });

  it('reads structured output from ORCHESTRATOR_SCRIPT_RESULT', async () => {
    await writeScript(
      'with-display',
      `#!/bin/bash
echo "raw stdout"
printf '%s' '{"message":"Published to https://example.com/gist"}' > "$ORCHESTRATOR_SCRIPT_RESULT"
`,
    );

    const result = await executor.execute({ script: 'with-display' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.output).toEqual({
      message: 'Published to https://example.com/gist',
    });
    /* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
    expect(streamBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Published to https://example.com/gist',
        structuredData: expect.objectContaining({
          messageType: 'script_completed',
          output: { message: 'Published to https://example.com/gist' },
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
  });

  it('reads directives from ORCHESTRATOR_SCRIPT_RESULT', async () => {
    await writeScript(
      'with-directives.ts',
      `
import { writeFileSync } from 'node:fs';
const resultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;
if (resultPath) {
  writeFileSync(resultPath, JSON.stringify({
    message: 'Cloned repo',
    directives: { repoRoot: '/tmp/pr-review-abc' },
  }), 'utf-8');
}
`,
      false,
    );

    const result = await executor.execute({ script: 'with-directives.ts' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.output?.directives?.repoRoot).toBe('/tmp/pr-review-abc');
  });

  it('ignores malformed structured script output without failing the script', async () => {
    await writeScript(
      'invalid-display',
      `#!/bin/bash
printf '%s' '{"message":""}' > "$ORCHESTRATOR_SCRIPT_RESULT"
`,
    );

    const result = await executor.execute({ script: 'invalid-display' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.output).toBeUndefined();
  });

  it('ignores non-JSON structured script output without failing the script', async () => {
    await writeScript(
      'non-json-display',
      `#!/bin/bash
printf '%s' 'not json' > "$ORCHESTRATOR_SCRIPT_RESULT"
`,
    );

    const result = await executor.execute({ script: 'non-json-display' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.output).toBeUndefined();
  });

  it('passes ORCHESTRATOR_USER_PROMPT to script', async () => {
    await writeScript('prompt-check', '#!/bin/bash\necho "$ORCHESTRATOR_USER_PROMPT"');

    const result = await executor.execute(
      { script: 'prompt-check' },
      context({ userPrompt: 'github:owner/repo#42' }),
    );

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('github:owner/repo#42');
  });

  it('includes orchestrator node_modules/.bin in PATH for scripts', async () => {
    await writeScript(
      'check-path.ts',
      `
const pathDirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
const hasBinDir = pathDirs.some(d => d.includes('node_modules/.bin'));
console.log(hasBinDir ? 'HAS_BIN_DIR' : 'NO_BIN_DIR');
`,
      false,
    );

    const result = await executor.execute({ script: 'check-path.ts' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('HAS_BIN_DIR');
  });

  it('caps stdout when output exceeds 1MB', async () => {
    const targetBytes = 2_000_000;
    await writeScript(
      'big-stdout.ts',
      [
        `const chunk = 'A'.repeat(100_003);`,
        `let written = 0;`,
        `while (written < ${String(targetBytes)}) { process.stdout.write(chunk); written += chunk.length; }`,
      ].join('\n'),
      false,
    );

    const result = await executor.execute({ script: 'big-stdout.ts' }, context());

    expect(result.success).toBe(true);
    const stdout = result.scriptResult?.stdout ?? '';
    expect(stdout.length).toBeLessThan(targetBytes);
    expect(stdout.length).toBeLessThanOrEqual(1_048_576 + 20);
  }, 15000);

  it('caps stderr when output exceeds 1MB', async () => {
    const targetBytes = 2_000_000;
    await writeScript(
      'big-stderr.ts',
      [
        `const chunk = 'E'.repeat(100_003);`,
        `let written = 0;`,
        `while (written < ${String(targetBytes)}) { process.stderr.write(chunk); written += chunk.length; }`,
      ].join('\n'),
      false,
    );

    const result = await executor.execute({ script: 'big-stderr.ts' }, context());

    expect(result.success).toBe(true);
    const stderr = result.scriptResult?.stderr ?? '';
    expect(stderr.length).toBeLessThan(targetBytes);
    expect(stderr.length).toBeLessThanOrEqual(1_048_576 + 20);
  }, 15000);

  it('falls back to tmpdir when repoRoot does not exist', async () => {
    await writeScript('cwd-fallback', '#!/bin/bash\necho "ok"');

    const result = await executor.execute(
      { script: 'cwd-fallback' },
      context({ repoRoot: '/nonexistent/path/that/does/not/exist' }),
    );

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('ok');
  });

  it('handles journal write failure gracefully in start event', async () => {
    const failingJournal = makeJournalWriter();
    (failingJournal.append as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('journal disk full');
    });
    const executorBadJournal = new ScriptExecutor({
      journalWriter: failingJournal,
      agentStreamBus: makeStreamBus(),
      globalScriptsDir: scriptsDir,
    });

    await writeScript('journal-fail', '#!/bin/bash\necho "ok"');

    const result = await executorBadJournal.execute({ script: 'journal-fail' }, context());

    expect(result.success).toBe(true);
    expect(result.scriptResult?.stdout).toContain('ok');
  });
});
