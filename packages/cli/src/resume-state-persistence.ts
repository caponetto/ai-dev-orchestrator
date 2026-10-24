import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DefaultStatePersistence } from '@ai-dev-orchestrator/core';
import { DefaultJournalReader } from '@ai-dev-orchestrator/journal';
import type { JournalWriter } from '@ai-dev-orchestrator/ports';
import type { LockHandle, PersistedState, RunId } from '@ai-dev-orchestrator/schemas';

import { projectHumanAnswer } from './human-answer-projection';
import { loadLatestRunState } from './run-state-recovery';

/** Fence a restored CLI context against durable progress made by another owner. */
export class ResumeStatePersistence extends DefaultStatePersistence {
  private revision: string;
  private owned: LockHandle | null = null;

  constructor(
    private readonly runsDir: string,
    private readonly targetRunId: string,
  ) {
    super(runsDir);
    // Capture before reading state/journal or asynchronously assembling infrastructure.
    this.revision = this.readRevision();
  }

  override acquireLock(runId: RunId): LockHandle {
    if (runId !== this.targetRunId) {
      throw new Error('Restored context belongs to another run');
    }
    const handle = super.acquireLock(runId);
    try {
      if (this.readRevision() !== this.revision) {
        throw new Error(
          `Run ${runId} changed since recovery was loaded; reload the run before retrying`,
        );
      }
      const runDir = join(this.runsDir, runId);
      const events = new DefaultJournalReader(join(runDir, 'journal.md')).readAll();
      projectHumanAnswer(runDir, loadLatestRunState(this, runId, events).state);
      this.owned = handle;
      return handle;
    } catch (error: unknown) {
      super.releaseLock(handle);
      throw error;
    }
  }

  guardJournal(writer: JournalWriter): JournalWriter {
    return {
      append: (event) => {
        if (this.owned) {
          writer.append(event);
        }
      },
      appendBatch: (events) => {
        if (this.owned) {
          writer.appendBatch(events);
        }
      },
    };
  }

  override async save(state: PersistedState): Promise<void> {
    if (!this.owned || state.runId !== this.targetRunId) {
      throw new Error('Cannot save a restored run without owning its lock');
    }
    await super.save(state);
    projectHumanAnswer(join(this.runsDir, state.runId), state);
  }

  override releaseLock(handle: LockHandle): void {
    if (this.owned !== handle) {
      return;
    }
    // Refresh while still owning the lock, so our own pauses may continue but an intervening
    // owner's progress cannot silently become the baseline of this in-memory engine.
    this.revision = this.readRevision();
    super.releaseLock(handle);
    this.owned = null;
  }

  private readRevision(): string {
    const hash = createHash('sha256');
    for (const file of ['state.yaml', 'journal.md']) {
      try {
        const bytes = readFileSync(join(this.runsDir, this.targetRunId, file));
        hash.update(`${file}:${String(bytes.length)}:`).update(bytes);
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error;
        }
        hash.update(`${file}:missing:`);
      }
    }
    return hash.digest('hex');
  }
}
