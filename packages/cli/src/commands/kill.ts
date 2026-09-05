import { execFileSync } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { RUN_LOCK_FILENAME } from '@ai-dev-orchestrator/schemas';
import type { RunId } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

import { TERMINAL_STATES, abortRunState } from '../abort-run';
import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { getRunsDir } from '../workspace-paths';

export interface KillOptions {
  readonly json: boolean;
  readonly verbose: boolean;
}

interface LockData {
  readonly pid?: number;
  readonly hostname?: string;
  readonly acquiredAt?: string;
}

interface LockInfo {
  readonly runId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly lockPath: string;
}

function readLock(lockPath: string): LockData | null {
  try {
    return parse(readFileSync(lockPath, 'utf8')) as LockData;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify the PID belongs to a node process (all platform-dispatched processes are Node.js).
 * Returns false if the process is clearly not ours (e.g. recycled PID running a browser).
 */
function isNodeProcess(pid: number): boolean {
  try {
    const comm = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    return comm.includes('node') || comm.includes('Node');
  } catch {
    // ps failed — process may have exited between our check and this call.
    // Err on the side of caution: treat as not verified.
    return false;
  }
}

/**
 * Verify the process start time is consistent with the lock's acquiredAt timestamp.
 * If the process started significantly after the lock was acquired, the PID was recycled.
 */
function isProcessStartTimeConsistent(pid: number, acquiredAt: string): boolean {
  const lockTime = new Date(acquiredAt).getTime();
  if (Number.isNaN(lockTime)) {
    return false;
  }

  try {
    const etimeRaw = execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();

    const elapsedMs = parseEtime(etimeRaw);
    if (elapsedMs === null) {
      return false;
    }

    const processStartMs = Date.now() - elapsedMs;
    // Allow 30s tolerance for clock skew and startup delay.
    // If the process started more than 30s after the lock was acquired, the PID was recycled.
    return processStartMs <= lockTime + 30_000;
  } catch {
    return false;
  }
}

/** Parse ps etime format [[dd-]hh:]mm:ss into milliseconds. */
function parseEtime(etime: string): number | null {
  const parts = etime.split(/[-:]/);
  if (parts.length < 2) {
    return null;
  }

  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) {
    return null;
  }

  let seconds = 0;
  if (nums.length === 2) {
    seconds = (nums[0] ?? 0) * 60 + (nums[1] ?? 0);
  } else if (nums.length === 3) {
    seconds = (nums[0] ?? 0) * 3600 + (nums[1] ?? 0) * 60 + (nums[2] ?? 0);
  } else if (nums.length === 4) {
    seconds = (nums[0] ?? 0) * 86400 + (nums[1] ?? 0) * 3600 + (nums[2] ?? 0) * 60 + (nums[3] ?? 0);
  }

  return seconds * 1000;
}

/**
 * Check persisted state to filter out stale locks from completed/aborted runs.
 * If the run reached a terminal state, its lock is stale — the PID may be recycled.
 */
function isRunStillActive(runsDir: string, runId: string): boolean {
  const statePersistence = new DefaultStatePersistence(runsDir);
  try {
    const state = statePersistence.load(runId as RunId);
    if (state && TERMINAL_STATES.has(state.currentState)) {
      return false;
    }
  } catch {
    // No checkpoint — could be a brand-new run that hasn't checkpointed yet.
    // Treat as active if the lock exists with a live PID.
  }
  return true;
}

function discoverActiveLocks(): LockInfo[] {
  const runsDir = getRunsDir();
  if (!existsSync(runsDir)) {
    return [];
  }

  const entries = readdirSync(runsDir, { withFileTypes: true }).filter((e: Dirent) =>
    e.isDirectory(),
  );

  const active: LockInfo[] = [];
  const thisHost = hostname();

  for (const entry of entries) {
    const lockPath = join(runsDir, entry.name, RUN_LOCK_FILENAME);
    if (!existsSync(lockPath)) {
      continue;
    }

    const lock = readLock(lockPath);
    if (!lock?.pid || lock.hostname !== thisHost) {
      continue;
    }

    if (!isProcessAlive(lock.pid)) {
      continue;
    }

    // Guard 1: skip if the run already reached a terminal state (stale lock).
    if (!isRunStillActive(runsDir, entry.name)) {
      continue;
    }

    // Guard 2: verify the PID is a Node.js process (all platform processes are Node).
    if (!isNodeProcess(lock.pid)) {
      continue;
    }

    // Guard 3: verify the process start time is consistent with the lock timestamp.
    if (lock.acquiredAt && !isProcessStartTimeConsistent(lock.pid, lock.acquiredAt)) {
      continue;
    }

    active.push({
      runId: entry.name,
      pid: lock.pid,
      hostname: thisHost,
      lockPath,
    });
  }

  return active;
}

function terminateProcess(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}

async function markRunAborted(runsDir: string, runId: string): Promise<void> {
  const statePersistence = new DefaultStatePersistence(runsDir);

  let state = null;
  try {
    state = statePersistence.load(runId as RunId);
  } catch {
    return;
  }

  if (!state || TERMINAL_STATES.has(state.currentState)) {
    return;
  }

  try {
    await abortRunState(statePersistence, runsDir, runId, state, 'Killed via CLI (ai kill)');
  } catch {
    // Best-effort — the process is already terminated.
  }
}

export async function killCommand(
  options: KillOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const activeLocks = discoverActiveLocks();

  if (activeLocks.length === 0) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ killed: [], count: 0 }) + '\n');
    } else {
      formatter.info('No active run processes found.');
    }
    return ExitCode.SUCCESS;
  }

  const runsDir = getRunsDir();
  const results: { runId: string; pid: number; terminated: boolean }[] = [];

  for (const lock of activeLocks) {
    const terminated = terminateProcess(lock.pid);

    if (terminated) {
      await markRunAborted(runsDir, lock.runId);
    }

    results.push({ runId: lock.runId, pid: lock.pid, terminated });

    if (options.verbose && !options.json) {
      const icon = terminated ? '✓' : '✗';
      formatter.info(
        `${icon} PID ${String(lock.pid)} (${lock.runId}): ${terminated ? 'killed' : 'failed'}`,
      );
    }
  }

  const killedCount = results.filter((r) => r.terminated).length;
  const failedCount = results.length - killedCount;

  if (options.json) {
    process.stdout.write(
      JSON.stringify({
        killed: results.map((r) => ({
          runId: r.runId,
          pid: r.pid,
          terminated: r.terminated,
        })),
        count: killedCount,
        failed: failedCount,
      }) + '\n',
    );
  } else {
    if (killedCount > 0) {
      formatter.success(`Killed ${String(killedCount)} active run${killedCount > 1 ? 's' : ''}.`);
    }
    if (failedCount > 0) {
      formatter.warn(
        `Failed to kill ${String(failedCount)} process${failedCount > 1 ? 'es' : ''}.`,
      );
    }
  }

  return failedCount > 0 ? ExitCode.GENERAL_ERROR : ExitCode.SUCCESS;
}
