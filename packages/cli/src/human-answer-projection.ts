import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PersistedState } from '@ai-dev-orchestrator/schemas';

/** Publish a derived compatibility file only while the caller owns the run lock. */
export function projectHumanAnswer(runDir: string, state: PersistedState | null): void {
  if (!state?.lastHumanAnswer) {
    return;
  }
  const dir = join(runDir, 'artifacts');
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (/^clarification_answers_v1\.md\.[0-9a-f-]{36}\.tmp$/.test(name)) {
      rmSync(join(dir, name), { force: true });
    }
  }
  const path = join(dir, 'clarification_answers_v1.md');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, state.lastHumanAnswer.content, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true,
    });
    renameSync(temporary, path);
  } finally {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Temporary-file cleanup cannot undo a committed projection or hide its write error.
    }
  }
}
