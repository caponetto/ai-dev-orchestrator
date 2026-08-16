import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ArtifactMetadata } from '@ai-orchestrator/schemas';
import { getErrorMessage } from '@ai-orchestrator/utils';
import writeFileAtomic from 'write-file-atomic';
import { stringify } from 'yaml';

import { DiskWriteError } from '../../domain/artifact-system/errors';

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true });
    await writeFileAtomic(filePath, content, { encoding: 'utf8' });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    throw new DiskWriteError(filePath, message);
  }
}

export async function writeMetadata(filePath: string, metadata: ArtifactMetadata): Promise<void> {
  const content = stringify(metadata);
  await atomicWrite(filePath, content);
}
