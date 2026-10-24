import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** Resolve only after OS process creation, without claiming engine ownership or completion. */
export async function spawnDetachedCli(
  baseDir: string,
  args: string[],
  logPath?: string,
  modelPreflightReceipt?: string,
  entry = process.argv[1],
): Promise<void> {
  let stderrFd: number | undefined;
  try {
    if (logPath) {
      stderrFd = openSync(logPath, 'a');
    }
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: existsSync(baseDir) ? baseDir : tmpdir(),
      detached: true,
      stdio: ['ignore', 'ignore', stderrFd ?? 'ignore'],
      ...(modelPreflightReceipt
        ? { env: { ...process.env, AI_ORCHESTRATOR_MODEL_PREFLIGHT: modelPreflightReceipt } }
        : {}),
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    child.unref();
  } finally {
    if (stderrFd !== undefined) {
      try {
        closeSync(stderrFd);
      } catch {
        // Cleanup cannot mask a spawn failure or undo an observed process launch.
      }
    }
  }
}
