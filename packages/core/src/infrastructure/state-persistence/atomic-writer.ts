import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { getErrorMessage } from '@ai-dev-orchestrator/utils';
import writeFileAtomic from 'write-file-atomic';

import { StatePersistenceError } from '../../domain/state-persistence/errors';

export async function atomicWriteState(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const bakPath = `${filePath}.bak`;

  try {
    mkdirSync(dir, { recursive: true });

    if (existsSync(filePath)) {
      // Preserve the primary until write-file-atomic replaces it. Readers and failed writes
      // must continue to see the last committed checkpoint throughout backup creation.
      await writeFileAtomic(bakPath, readFileSync(filePath, 'utf8'), { encoding: 'utf8' });
    }

    await writeFileAtomic(filePath, content, { encoding: 'utf8' });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    throw new StatePersistenceError(`Atomic write failed for "${filePath}": ${message}`);
  }
}
