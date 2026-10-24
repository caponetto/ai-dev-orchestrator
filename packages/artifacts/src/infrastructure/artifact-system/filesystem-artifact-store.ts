import { join, resolve } from 'node:path';

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
  ArtifactType,
  IntegrityResult,
} from '@ai-dev-orchestrator/schemas';

import {
  ImmutabilityViolationError,
  OwnershipViolationError,
  TypeValidationError,
} from '../../domain/artifact-system/errors';

import { ArtifactWriteRecovery } from './artifact-write-recovery';
import { computeChecksum, verifyChecksum } from './checksum-engine';
import { fileExists, readContent, readMetadata } from './disk-reader';
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

// One run owner can dispatch several workers and construct more than one store. Keep version
// allocation, content/metadata writes and inventory updates in the same process in order.
const pendingWrites = new Map<string, Promise<void>>();

/** Filesystem-backed artifact store with serialized writes within the run owner process. */
export class FilesystemArtifactStore implements ArtifactStore {
  private readonly artifactsDir: string;
  private readonly versionManager: VersionManager;
  private readonly inventoryManager: InventoryManager;
  private readonly writeRecovery: ArtifactWriteRecovery;
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
    this.writeRecovery = new ArtifactWriteRecovery(this.artifactsDir, runId, this.inventoryManager);
    this.ownershipRegistry = ownershipRegistry;
    this.typeValidator = typeValidator;
  }

  store(input: ArtifactInput): Promise<ArtifactRef> {
    return this.withRunQueue(() => this.storeVersion(input));
  }

  private withRunQueue<T>(operation: () => Promise<T>): Promise<T> {
    const key = resolve(this.artifactsDir);
    const predecessor = pendingWrites.get(key) ?? Promise.resolve();
    const result = predecessor.then(async () => {
      await this.writeRecovery.recover();
      return operation();
    });
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    pendingWrites.set(key, settled);
    void settled.then(() => {
      if (pendingWrites.get(key) === settled) {
        pendingWrites.delete(key);
      }
    });
    return result;
  }

  private async storeVersion(input: ArtifactInput): Promise<ArtifactRef> {
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

    // Fail before creating files when the existing index is known to be corrupt.
    this.inventoryManager.getInventory();
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
    await this.writeRecovery.commit(input.content, metadata);

    return ref;
  }

  get(ref: ArtifactRef): Promise<Artifact> {
    return this.withRunQueue(() => Promise.resolve(this.readArtifact(ref)));
  }

  private readArtifact(ref: ArtifactRef): Artifact {
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
    return this.withRunQueue(() => {
      const refs = this.inventoryManager.listRefs({ type, name });
      const latest = refs.sort((a, b) => b.version - a.version).at(0);
      return Promise.resolve(latest ? this.readArtifact(latest) : null);
    });
  }

  list(query: ArtifactQuery): Promise<ArtifactRef[]> {
    return this.withRunQueue(() => {
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
    });
  }

  history(type: ArtifactType, name: string): Promise<ArtifactRef[]> {
    return this.withRunQueue(() =>
      Promise.resolve(
        this.inventoryManager.listRefs({ type, name }).sort((a, b) => a.version - b.version),
      ),
    );
  }

  verify(ref: ArtifactRef): Promise<IntegrityResult> {
    return this.withRunQueue(() => {
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
    });
  }

  inventory(): Promise<ArtifactInventory> {
    return this.withRunQueue(() => Promise.resolve(this.inventoryManager.getInventory()));
  }

  private artifactContentPath(type: ArtifactType, name: string, version: number): string {
    return join(this.artifactsDir, type, `${name}_v${String(version)}.md`);
  }

  private artifactMetaPath(type: ArtifactType, name: string, version: number): string {
    return join(this.artifactsDir, type, `${name}_v${String(version)}.meta.yaml`);
  }
}
