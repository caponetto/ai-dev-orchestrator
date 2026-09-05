import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { getErrorMessage } from '@ai-dev-orchestrator/utils';

import { JournalWriteError } from '../domain/errors';

/** Append content to a journal file with fsync for durability. */
export function flushToFile(filePath: string, content: string, header?: string): void {
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    if (!existsSync(filePath) && header) {
      writeFileSync(filePath, header, 'utf8');
    }

    appendFileSync(filePath, content, 'utf8');

    const fd = openSync(filePath, 'a');
    try {
      fsyncSync(fd);
    } catch {
      // Best-effort fsync
    } finally {
      closeSync(fd);
    }
  } catch (error: unknown) {
    if (error instanceof JournalWriteError) {
      throw error;
    }
    const message = getErrorMessage(error);
    throw new JournalWriteError(message);
  }
}
