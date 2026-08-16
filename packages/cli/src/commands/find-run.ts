import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getJournalPath, getRunsDir, getStatePath } from '../workspace-paths';

function listRunIds(): string[] {
  const runsDir = getRunsDir();
  if (!existsSync(runsDir)) {
    return [];
  }

  return readdirSync(runsDir, { withFileTypes: true })
    .filter((e: Dirent) => e.isDirectory())
    .map((e: Dirent) => e.name)
    .sort()
    .reverse();
}

/** Find the most recent run directory (any state). */
export function findLatestRunId(): string | null {
  return listRunIds()[0] ?? null;
}

/** Find the most recent run directory that has a persisted state file. */
export function findLatestRunWithState(): string | null {
  for (const runId of listRunIds()) {
    const statePath = getStatePath(join(getRunsDir(), runId));
    if (existsSync(statePath)) {
      return runId;
    }
  }
  return null;
}

const TERMINAL_STATE_RE = /^currentState:\s*['"]?(DONE|ABORTED)['"]?\s*$/m;
const TERMINAL_JOURNAL_RE = /\bto:\s*['"]?(?:DONE|ABORTED)['"]?\s*$/m;
const RUN_ABORTED_RE = /\btype:\s*['"]?run_aborted['"]?\s*$/m;

function isTerminalRun(statePath: string): boolean {
  try {
    const content = readFileSync(statePath, 'utf-8');
    return TERMINAL_STATE_RE.test(content);
  } catch {
    return false;
  }
}

function isTerminalJournal(journalPath: string): boolean {
  try {
    const content = readFileSync(journalPath, 'utf-8');
    return TERMINAL_JOURNAL_RE.test(content) || RUN_ABORTED_RE.test(content);
  } catch {
    return false;
  }
}

/** Find the most recent run that is not in a terminal state (for resume). */
export function findLatestInterruptedRun(): string | null {
  const runsDir = getRunsDir();

  for (const runId of listRunIds()) {
    const runDir = join(runsDir, runId);
    const statePath = getStatePath(runDir);

    if (existsSync(statePath)) {
      if (!isTerminalRun(statePath)) {
        return runId;
      }
      continue;
    }

    const journalPath = getJournalPath(runDir);
    if (existsSync(journalPath)) {
      if (!isTerminalJournal(journalPath)) {
        return runId;
      }
    }
  }

  return null;
}
