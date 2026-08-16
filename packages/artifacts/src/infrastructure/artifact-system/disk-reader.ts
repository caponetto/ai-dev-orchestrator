import { existsSync, readFileSync } from 'node:fs';

import type { ArtifactMetadata, ArtifactRef } from '@ai-orchestrator/schemas';
import { parse } from 'yaml';

import { ArtifactNotFoundError } from '../../domain/artifact-system/errors';

/** Read artifact content from disk. Throws ArtifactNotFoundError if the file does not exist. */
export function readContent(filePath: string, ref: ArtifactRef): string {
  if (!existsSync(filePath)) {
    throw new ArtifactNotFoundError(ref);
  }
  return readFileSync(filePath, 'utf8');
}

/** Read and parse artifact metadata from a YAML sidecar file. */
export function readMetadata(filePath: string, ref: ArtifactRef): ArtifactMetadata {
  if (!existsSync(filePath)) {
    throw new ArtifactNotFoundError(ref);
  }
  const content = readFileSync(filePath, 'utf8');
  return parse(content) as ArtifactMetadata;
}

/** Check if a file exists on disk. */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
