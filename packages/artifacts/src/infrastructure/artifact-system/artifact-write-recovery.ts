import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { artifactMetadataSchema } from '@ai-dev-orchestrator/schemas';
import type { ArtifactMetadata } from '@ai-dev-orchestrator/schemas';
import { parse, stringify } from 'yaml';
import { z } from 'zod/v4';

import { InventoryCorruptionError } from '../../domain/artifact-system/errors';

import { computeChecksum } from './checksum-engine';
import { fileExists, readContent, readMetadata } from './disk-reader';
import { atomicWrite, writeMetadata } from './disk-writer';
import type { InventoryManager } from './inventory-manager';

const pendingWriteSchema = z.object({
  runId: z.string(),
  content: z.string(),
  metadata: artifactMetadataSchema.extend({
    name: z
      .string()
      .min(1)
      .refine((name) => basename(name) === name && name !== '.' && name !== '..'),
    version: z.number().int().positive(),
    sizeBytes: z.number().int().nonnegative(),
  }),
});

/** Recover one prepared write under the run owner's shared operation queue. */
export class ArtifactWriteRecovery {
  private readonly pendingPath: string;

  constructor(
    private readonly artifactsDir: string,
    private readonly runId: string,
    private readonly inventory: InventoryManager,
  ) {
    this.pendingPath = join(artifactsDir, '.pending-write.yaml');
  }

  async commit(content: string, metadata: ArtifactMetadata): Promise<void> {
    // A completed intent write is the point after which recovery finishes this version.
    if (metadata.runId !== undefined && metadata.runId !== this.runId) {
      throw new InventoryCorruptionError('Artifact run identity does not match the owning store');
    }
    const pending = pendingWriteSchema.parse({ runId: this.runId, content, metadata });
    await atomicWrite(this.pendingPath, stringify(pending));
    await this.recover();
  }

  async recover(): Promise<void> {
    if (!fileExists(this.pendingPath)) {
      return;
    }
    const invalid = (detail: string) =>
      new InventoryCorruptionError(
        `Cannot recover pending artifact write at ${this.pendingPath}: ${detail}. Preserve the record and reconcile the conflicting files before retrying`,
      );
    let pending: ReturnType<typeof pendingWriteSchema.safeParse>;
    try {
      pending = pendingWriteSchema.safeParse(
        parse(
          readContent(this.pendingPath, {
            type: 'run_manifest',
            name: 'pending-write',
            version: 0,
            checksum: '',
          }),
        ),
      );
    } catch {
      throw invalid('invalid YAML recovery record');
    }
    if (!pending.success) {
      throw invalid('invalid recovery record');
    }
    const { content, metadata, runId } = pending.data;
    if (
      runId !== this.runId ||
      (metadata.runId !== undefined && metadata.runId !== this.runId) ||
      metadata.checksum !== computeChecksum(content) ||
      metadata.sizeBytes !== Buffer.byteLength(content, 'utf8')
    ) {
      throw invalid('run identity, checksum or size does not match the recovery record');
    }
    const { type, name, version, checksum } = metadata;
    const ref = { type, name, version, checksum };
    const contentPath = join(this.artifactsDir, type, `${name}_v${String(version)}.md`);
    const metaPath = join(this.artifactsDir, type, `${name}_v${String(version)}.meta.yaml`);
    const summary = {
      ref,
      type,
      name,
      version,
      producedBy: metadata.producedBy,
      createdAt: metadata.createdAt,
      sizeBytes: metadata.sizeBytes,
    };
    const existing = this.inventory
      .getInventory()
      .artifacts.find(
        (entry) => entry.type === type && entry.name === name && entry.version === version,
      );
    if (existing && !isDeepStrictEqual(existing, summary)) {
      throw invalid('inventory summary conflict');
    }
    const hasContent = fileExists(contentPath);
    const hasMetadata = fileExists(metaPath);
    // Check all existing evidence before writing any missing file. Never overwrite a conflict.
    if (hasContent && readContent(contentPath, ref) !== content) {
      throw invalid('content conflict');
    }
    if (hasMetadata && !isDeepStrictEqual(readMetadata(metaPath, ref), metadata)) {
      throw invalid('metadata conflict');
    }
    if (!hasContent) {
      await atomicWrite(contentPath, content);
    }
    if (!hasMetadata) {
      await writeMetadata(metaPath, metadata);
    }
    if (!existing) {
      await this.inventory.addEntry(summary);
    }
    await rm(this.pendingPath);
  }
}
