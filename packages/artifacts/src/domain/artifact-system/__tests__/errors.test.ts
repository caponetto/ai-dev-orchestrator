import { OrchestratorError } from '@ai-orchestrator/ports';
import type { ArtifactRef } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  ArtifactNotFoundError,
  ChecksumMismatchError,
  DiskWriteError,
  ImmutabilityViolationError,
  InventoryCorruptionError,
  OwnershipViolationError,
  TypeValidationError,
} from '../errors';

const sampleRef: ArtifactRef = {
  type: 'plan',
  name: 'plan',
  version: 1,
  checksum: 'sha256:abc123',
};

describe('artifact system errors', () => {
  it('OwnershipViolationError includes role, type, and owner', () => {
    const error = new OwnershipViolationError('reviewer', 'plan', 'planner');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('OWNERSHIP_VIOLATION');
    expect(error.recoverable).toBe(false);
    expect(error.role).toBe('reviewer');
    expect(error.artifactType).toBe('plan');
    expect(error.ownerRole).toBe('planner');
    expect(error.message).toContain('reviewer');
    expect(error.message).toContain('planner');
  });

  it('ImmutabilityViolationError includes ref details', () => {
    const error = new ImmutabilityViolationError(sampleRef);
    expect(error.code).toBe('IMMUTABILITY_VIOLATION');
    expect(error.recoverable).toBe(false);
    expect(error.ref).toBe(sampleRef);
    expect(error.message).toContain('plan/plan v1');
  });

  it('ChecksumMismatchError includes expected and actual checksums', () => {
    const error = new ChecksumMismatchError(sampleRef, 'sha256:expected', 'sha256:actual');
    expect(error.code).toBe('CHECKSUM_MISMATCH');
    expect(error.recoverable).toBe(false);
    expect(error.expectedChecksum).toBe('sha256:expected');
    expect(error.actualChecksum).toBe('sha256:actual');
    expect(error.message).toContain('sha256:expected');
    expect(error.message).toContain('sha256:actual');
  });

  it('ArtifactNotFoundError includes ref details', () => {
    const error = new ArtifactNotFoundError(sampleRef);
    expect(error.code).toBe('ARTIFACT_NOT_FOUND');
    expect(error.recoverable).toBe(false);
    expect(error.ref).toBe(sampleRef);
    expect(error.message).toContain('plan/plan v1');
  });

  it('TypeValidationError includes type and validation errors', () => {
    const validationErrors = [
      { path: '/title', message: 'is required' },
      { path: '/sections', message: 'must be array' },
    ];
    const error = new TypeValidationError('canonical_specification', validationErrors);
    expect(error.code).toBe('TYPE_VALIDATION_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.artifactType).toBe('canonical_specification');
    expect(error.validationErrors).toBe(validationErrors);
    expect(error.message).toContain('/title: is required');
    expect(error.message).toContain('/sections: must be array');
  });

  it('InventoryCorruptionError includes descriptive message', () => {
    const error = new InventoryCorruptionError('3 artifacts missing from disk');
    expect(error.code).toBe('INVENTORY_CORRUPTION');
    expect(error.recoverable).toBe(false);
    expect(error.message).toContain('3 artifacts missing from disk');
  });

  it('DiskWriteError includes file path and cause', () => {
    const error = new DiskWriteError('/tmp/artifact.md', 'ENOSPC: no space left');
    expect(error.code).toBe('DISK_WRITE_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.filePath).toBe('/tmp/artifact.md');
    expect(error.cause).toBe('ENOSPC: no space left');
    expect(error.message).toContain('/tmp/artifact.md');
  });

  it('all errors have correct name from constructor', () => {
    expect(new OwnershipViolationError('a', 'plan', 'b').name).toBe('OwnershipViolationError');
    expect(new ImmutabilityViolationError(sampleRef).name).toBe('ImmutabilityViolationError');
    expect(new ChecksumMismatchError(sampleRef, 'a', 'b').name).toBe('ChecksumMismatchError');
    expect(new ArtifactNotFoundError(sampleRef).name).toBe('ArtifactNotFoundError');
    expect(new TypeValidationError('plan', []).name).toBe('TypeValidationError');
    expect(new InventoryCorruptionError('msg').name).toBe('InventoryCorruptionError');
    expect(new DiskWriteError('/p', 'c').name).toBe('DiskWriteError');
  });
});
