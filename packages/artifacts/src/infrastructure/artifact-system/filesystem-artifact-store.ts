import { join } from 'node:path';

import type {
  ArtifactStore,
  ArtifactTypeValidator,
  OwnershipRegistry,
} from '@ai-dev-orchestrator/ports';
import type {
  Artifact,
  ArtifactInput,
  ArtifactInventory,
  ArtifactMetadata,
  ArtifactQuery,
  ArtifactRef,
  ArtifactSummary,
  ArtifactType,
  IntegrityResult,
} from '@ai-dev-orchestrator/schemas';

import {
  ImmutabilityViolationError,
  OwnershipViolationError,
  TypeValidationError,
} from '../../domain/artifact-system/errors';

import { computeChecksum, verifyChecksum } from './checksum-engine';
import { fileExists, readContent, readMetadata } from './disk-reader';
import { atomicWrite, writeMetadata } from './disk-writer';
import { InventoryManager } from './inventory-manager';
import { VersionManager } from './version-manager';

const FAIL_SAFE_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set([
  'plan_review',
  'static_review',
  'security_review',
  'performance_review',
  'verification',
  'judge_decision',
]);

/**
 * Filesystem-backed artifact store using synchronous I/O.
 *
 * Sync operations are accepted here: artifacts are small text files written once
 * and read infrequently, so async I/O adds complexity without measurable benefit.
 * Async migration is deferred to S14 if profiling shows contention.
 */
export class FilesystemArtifactStore implements ArtifactStore {
  private readonly artifactsDir: string;
  private readonly versionManager: VersionManager;
  private readonly inventoryManager: InventoryManager;
  private readonly ownershipRegistry: OwnershipRegistry;
  private readonly typeValidator: ArtifactTypeValidator;

  constructor(
    runDir: string,
    runId: string,
    ownershipRegistry: OwnershipRegistry,
    typeValidator: ArtifactTypeValidator,
  ) {
    this.artifactsDir = join(runDir, 'artifacts');
    this.versionManager = new VersionManager(this.artifactsDir);
    this.inventoryManager = new InventoryManager(runDir, runId);
    this.ownershipRegistry = ownershipRegistry;
    this.typeValidator = typeValidator;
  }

  async store(input: ArtifactInput): Promise<ArtifactRef> {
    if (!this.ownershipRegistry.isAuthorized(input.producedBy, input.type)) {
      const owner = this.ownershipRegistry.getOwner(input.type);
      throw new OwnershipViolationError(input.producedBy, input.type, owner ?? 'unknown');
    }

    let validationFailed = false;
    if (!input.preValidated) {
      const validationResult = this.typeValidator.validate(input.type, input.content);
      if (!validationResult.valid) {
        if (FAIL_SAFE_ARTIFACT_TYPES.has(input.type)) {
          validationFailed = true;
        } else {
          throw new TypeValidationError(
            input.type,
            validationResult.errors ?? [{ path: '/', message: 'Validation failed' }],
          );
        }
      }
    }

    const version = this.versionManager.nextVersion(input.type, input.name);

    const existingPath = this.artifactContentPath(input.type, input.name, version);
    if (fileExists(existingPath)) {
      throw new ImmutabilityViolationError({
        type: input.type,
        name: input.name,
        version,
        checksum: '',
      });
    }

    const checksum = computeChecksum(input.content);
    const createdAt = new Date().toISOString();
    const sizeBytes = Buffer.byteLength(input.content, 'utf8');

    const ref: ArtifactRef = { type: input.type, name: input.name, version, checksum };

    await atomicWrite(existingPath, input.content);

    const metadata: ArtifactMetadata = {
      type: input.type,
      name: input.name,
      runId: input.runId,
      version,
      checksum,
      producedBy: input.producedBy,
      predecessorRef: input.predecessorRef ?? null,
      createdAt,
      sizeBytes,
      metadata: validationFailed ? { ...input.metadata, validationFailed: true } : input.metadata,
    };
    const metaPath = this.artifactMetaPath(input.type, input.name, version);
    await writeMetadata(metaPath, metadata);

    const summary: ArtifactSummary = {
      ref,
      type: input.type,
      name: input.name,
      version,
      producedBy: input.producedBy,
      createdAt,
      sizeBytes,
    };
    await this.inventoryManager.addEntry(summary);

    return ref;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(ref: ArtifactRef): Promise<Artifact> {
    const contentPath = this.artifactContentPath(ref.type, ref.name, ref.version);
    const metaPath = this.artifactMetaPath(ref.type, ref.name, ref.version);

    const content = readContent(contentPath, ref);
    const meta = readMetadata(metaPath, ref);

    return {
      ref,
      type: meta.type,
      name: meta.name,
      version: meta.version,
      content,
      checksum: meta.checksum,
      producedBy: meta.producedBy,
      predecessorRef: meta.predecessorRef ?? undefined,
      createdAt: meta.createdAt,
      sizeBytes: meta.sizeBytes,
      metadata: meta.metadata,
    };
  }

  getLatest(type: ArtifactType, name: string): Promise<Artifact | null> {
    const latest = this.versionManager.latestVersion(type, name);
    if (latest === null) {
      return Promise.resolve(null);
    }

    const contentPath = this.artifactContentPath(type, name, latest);
    const metaPath = this.artifactMetaPath(type, name, latest);
    const ref: ArtifactRef = { type, name, version: latest, checksum: '' };

    const content = readContent(contentPath, ref);
    const meta = readMetadata(metaPath, ref);

    return Promise.resolve({
      ref: { type, name, version: latest, checksum: meta.checksum },
      type: meta.type,
      name: meta.name,
      version: meta.version,
      content,
      checksum: meta.checksum,
      producedBy: meta.producedBy,
      predecessorRef: meta.predecessorRef ?? undefined,
      createdAt: meta.createdAt,
      sizeBytes: meta.sizeBytes,
      metadata: meta.metadata,
    });
  }

  list(query: ArtifactQuery): Promise<ArtifactRef[]> {
    let refs = this.inventoryManager.listRefs({
      type: query.type,
      name: query.name,
      producedBy: query.producedBy,
    });

    const minVersion = query.minVersion;
    if (minVersion !== undefined) {
      refs = refs.filter((r) => r.version >= minVersion);
    }
    const maxVersion = query.maxVersion;
    if (maxVersion !== undefined) {
      refs = refs.filter((r) => r.version <= maxVersion);
    }

    return Promise.resolve(refs);
  }

  history(type: ArtifactType, name: string): Promise<ArtifactRef[]> {
    const versions = this.versionManager.listVersions(type, name);
    const refs: ArtifactRef[] = [];

    for (const version of versions) {
      const metaPath = this.artifactMetaPath(type, name, version);
      const dummyRef: ArtifactRef = { type, name, version, checksum: '' };
      try {
        const meta = readMetadata(metaPath, dummyRef);
        refs.push({ type, name, version, checksum: meta.checksum });
      } catch {
        refs.push(dummyRef);
      }
    }

    return Promise.resolve(refs);
  }

  verify(ref: ArtifactRef): Promise<IntegrityResult> {
    const contentPath = this.artifactContentPath(ref.type, ref.name, ref.version);
    const content = readContent(contentPath, ref);
    const actualChecksum = computeChecksum(content);
    const valid = verifyChecksum(content, ref.checksum);

    return Promise.resolve({
      valid,
      expectedChecksum: ref.checksum,
      actualChecksum,
      ref,
    });
  }

  inventory(): Promise<ArtifactInventory> {
    return Promise.resolve(this.inventoryManager.getInventory());
  }

  private artifactContentPath(type: ArtifactType, name: string, version: number): string {
    return join(this.artifactsDir, type, `${name}_v${String(version)}.md`);
  }

  private artifactMetaPath(type: ArtifactType, name: string, version: number): string {
    return join(this.artifactsDir, type, `${name}_v${String(version)}.meta.yaml`);
  }
}
