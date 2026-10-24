import { existsSync, readFileSync } from 'node:fs';

import type { ArtifactMetadata, ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { artifactMetadataSchema } from '@ai-dev-orchestrator/schemas';
import { parse } from 'yaml';

import {
  ArtifactNotFoundError,
  InventoryCorruptionError,
} from '../../domain/artifact-system/errors';

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
  try {
    // Older sidecars omitted predecessorRef; preserve their read compatibility.
    const metadata = artifactMetadataSchema
      .extend({
        predecessorRef: artifactMetadataSchema.shape.predecessorRef.default(null),
      })
      .parse(parse(content));
    if (
      metadata.type !== ref.type ||
      metadata.name !== ref.name ||
      metadata.version !== ref.version ||
      !Number.isSafeInteger(metadata.version) ||
      metadata.version < 1 ||
      !Number.isSafeInteger(metadata.sizeBytes) ||
      metadata.sizeBytes < 0
    ) {
      throw new Error('metadata identity or size is invalid');
    }
    return metadata;
  } catch {
    throw new InventoryCorruptionError(
      `Invalid artifact metadata at ${filePath}; preserve and repair the sidecar before retrying`,
    );
  }
}

/** Check if a file exists on disk. */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}
