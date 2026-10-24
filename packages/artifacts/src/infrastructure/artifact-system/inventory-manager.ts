import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  INVENTORY_FILENAME,
  artifactSummarySchema,
  type ArtifactInventory,
  type ArtifactRef,
  type ArtifactSummary,
  type ArtifactType,
} from '@ai-dev-orchestrator/schemas';
import { parse, stringify } from 'yaml';

import { InventoryCorruptionError } from '../../domain/artifact-system/errors';

import { computeChecksum } from './checksum-engine';
import { fileExists, readContent, readMetadata } from './disk-reader';
import { atomicWrite } from './disk-writer';

export class InventoryManager {
  private artifacts: ArtifactSummary[] = [];
  private readonly runId: string;
  private readonly inventoryPath: string;

  constructor(runDir: string, runId: string) {
    this.runId = runId;
    this.inventoryPath = join(runDir, INVENTORY_FILENAME);
  }

  async addEntry(summary: ArtifactSummary): Promise<void> {
    // Another store owned by this run may have committed entries since construction.
    this.loadFromDisk();
    this.artifacts.push(summary);
    await this.persist();
  }

  async removeEntry(ref: ArtifactRef): Promise<void> {
    this.loadFromDisk();
    this.artifacts = this.artifacts.filter(
      (a) => !(a.ref.type === ref.type && a.ref.name === ref.name && a.ref.version === ref.version),
    );
    await this.persist();
  }

  getInventory(): ArtifactInventory {
    this.loadFromDisk();
    const totalSizeBytes = this.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
    return {
      runId: this.runId,
      artifacts: [...this.artifacts],
      totalCount: this.artifacts.length,
      totalSizeBytes,
    };
  }

  listRefs(query?: { type?: ArtifactType; name?: string; producedBy?: string }): ArtifactRef[] {
    this.loadFromDisk();
    let filtered = this.artifacts;
    if (query?.type) {
      filtered = filtered.filter((a) => a.type === query.type);
    }
    if (query?.name) {
      filtered = filtered.filter((a) => a.name === query.name);
    }
    if (query?.producedBy) {
      filtered = filtered.filter((a) => a.producedBy === query.producedBy);
    }
    return filtered.map((a) => a.ref);
  }

  async rebuild(artifactsDir: string): Promise<ArtifactInventory> {
    // Stage rebuilt entries locally. A failed scan must not replace the previous index.
    const rebuilt: ArtifactSummary[] = [];
    if (fileExists(join(artifactsDir, '.pending-write.yaml'))) {
      throw new InventoryCorruptionError(
        'Pending artifact write must be recovered through the artifact store before rebuilding inventory',
      );
    }
    if (!existsSync(artifactsDir)) {
      if (this.getInventory().totalCount > 0) {
        throw new InventoryCorruptionError(
          `Artifact directory is missing at ${artifactsDir}; restore the files before rebuilding the existing inventory`,
        );
      }
      this.artifacts = rebuilt;
      await this.persist();
      return this.getInventory();
    }

    const typeDirs = readdirSync(artifactsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const typeDir of typeDirs) {
      const typePath = join(artifactsDir, typeDir);
      const files = readdirSync(typePath).filter((f) => f.endsWith('.meta.yaml'));

      for (const metaFile of files) {
        const metaPath = join(typePath, metaFile);
        try {
          const metaRef: ArtifactRef = {
            type: typeDir as ArtifactType,
            name: metaFile.replace(/_v\d+\.meta\.yaml$/, ''),
            version: Number(/_v(\d+)\.meta\.yaml$/.exec(metaFile)?.[1]),
            checksum: '',
          };
          const meta = readMetadata(metaPath, metaRef);
          const expectedName = `${meta.name}_v${String(meta.version)}.meta.yaml`;
          const contentPath = join(typePath, `${meta.name}_v${String(meta.version)}.md`);
          const content = readContent(contentPath, metaRef);
          if (
            metaFile !== expectedName ||
            meta.type !== typeDir ||
            (meta.runId !== undefined && meta.runId !== this.runId) ||
            meta.checksum !== computeChecksum(content) ||
            meta.sizeBytes !== Buffer.byteLength(content, 'utf8')
          ) {
            throw new Error('metadata identity, content checksum or size mismatch');
          }

          const summary: ArtifactSummary = {
            ref: {
              type: meta.type,
              name: meta.name,
              version: meta.version,
              checksum: meta.checksum,
            },
            type: meta.type,
            name: meta.name,
            version: meta.version,
            producedBy: meta.producedBy,
            createdAt: meta.createdAt,
            sizeBytes: meta.sizeBytes,
          };
          rebuilt.push(summary);
        } catch {
          throw new InventoryCorruptionError(
            `Cannot rebuild from ${metaPath}: invalid metadata, identity or content. Preserve the current inventory and reconcile the artifact files before retrying`,
          );
        }
      }
    }

    this.artifacts = rebuilt;
    await this.persist();
    return this.getInventory();
  }

  private loadFromDisk(): void {
    if (!fileExists(this.inventoryPath)) {
      this.artifacts = [];
      return;
    }

    try {
      const inventoryRef: ArtifactRef = {
        type: 'run_manifest',
        name: 'inventory',
        version: 0,
        checksum: '',
      };
      const content = readContent(this.inventoryPath, inventoryRef);
      const data = parse(content) as { artifacts?: unknown[] };
      if (!Array.isArray(data.artifacts)) {
        throw new InventoryCorruptionError('Expected an artifacts array');
      }
      this.artifacts = (data.artifacts as ArtifactSummary[]).map((raw) => {
        const r = raw as unknown as Record<string, unknown>;
        const ref: ArtifactRef = (r.ref as ArtifactRef | undefined) ?? {
          type: raw.type,
          name: raw.name,
          version: raw.version,
          checksum: typeof r.checksum === 'string' ? r.checksum : '',
        };
        const summary = artifactSummarySchema.safeParse({ ...raw, ref });
        if (
          !summary.success ||
          ref.type !== raw.type ||
          ref.name !== raw.name ||
          ref.version !== raw.version
        ) {
          throw new InventoryCorruptionError('Invalid or inconsistent artifact summary');
        }
        return summary.data;
      });
    } catch (error: unknown) {
      if (error instanceof InventoryCorruptionError) {
        throw error;
      }
      throw new InventoryCorruptionError(`Failed to parse inventory file: ${this.inventoryPath}`);
    }
  }

  private async persist(): Promise<void> {
    const data = {
      runId: this.runId,
      updatedAt: new Date().toISOString(),
      totalCount: this.artifacts.length,
      totalSizeBytes: this.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
      artifacts: this.artifacts.map((a) => ({
        ref: a.ref,
        type: a.type,
        name: a.name,
        version: a.version,
        producedBy: a.producedBy,
        createdAt: a.createdAt,
        sizeBytes: a.sizeBytes,
      })),
    };
    await atomicWrite(this.inventoryPath, stringify(data));
  }
}
