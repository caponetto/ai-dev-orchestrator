import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  INVENTORY_FILENAME,
  type ArtifactInventory,
  type ArtifactMetadata,
  type ArtifactRef,
  type ArtifactSummary,
  type ArtifactType,
} from '@ai-dev-orchestrator/schemas';
import { parse, stringify } from 'yaml';

import { InventoryCorruptionError } from '../../domain/artifact-system/errors';

import { fileExists, readContent } from './disk-reader';
import { atomicWrite } from './disk-writer';

export class InventoryManager {
  private artifacts: ArtifactSummary[] = [];
  private readonly runId: string;
  private readonly inventoryPath: string;

  constructor(runDir: string, runId: string) {
    this.runId = runId;
    this.inventoryPath = join(runDir, INVENTORY_FILENAME);
    this.loadFromDisk();
  }

  async addEntry(summary: ArtifactSummary): Promise<void> {
    this.artifacts.push(summary);
    await this.persist();
  }

  async removeEntry(ref: ArtifactRef): Promise<void> {
    this.artifacts = this.artifacts.filter(
      (a) => !(a.ref.type === ref.type && a.ref.name === ref.name && a.ref.version === ref.version),
    );
    await this.persist();
  }

  getInventory(): ArtifactInventory {
    const totalSizeBytes = this.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
    return {
      runId: this.runId,
      artifacts: [...this.artifacts],
      totalCount: this.artifacts.length,
      totalSizeBytes,
    };
  }

  listRefs(query?: { type?: ArtifactType; name?: string; producedBy?: string }): ArtifactRef[] {
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
    this.artifacts = [];

    if (!existsSync(artifactsDir)) {
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
            name: '',
            version: 0,
            checksum: '',
          };
          const raw = readContent(metaPath, metaRef);
          const meta = parse(raw) as ArtifactMetadata;

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
          this.artifacts.push(summary);
        } catch {
          throw new InventoryCorruptionError(`Failed to parse metadata file: ${metaPath}`);
        }
      }
    }

    await this.persist();
    return this.getInventory();
  }

  private loadFromDisk(): void {
    if (!fileExists(this.inventoryPath)) {
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
      if (Array.isArray(data.artifacts)) {
        this.artifacts = (data.artifacts as ArtifactSummary[]).map((raw) => {
          const r = raw as unknown as Record<string, unknown>;
          const ref: ArtifactRef = (r.ref as ArtifactRef | undefined) ?? {
            type: raw.type,
            name: raw.name,
            version: raw.version,
            checksum: typeof r.checksum === 'string' ? r.checksum : '',
          };
          return { ...raw, ref };
        });
      }
    } catch {
      this.artifacts = [];
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
