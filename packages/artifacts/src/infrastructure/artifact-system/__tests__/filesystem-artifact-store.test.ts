import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactInput } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import {
  ArtifactNotFoundError,
  OwnershipViolationError,
  TypeValidationError,
} from '../../../domain/artifact-system/errors';
import { DefaultArtifactTypeValidator } from '../artifact-type-validator';
import { DefaultOwnershipRegistry } from '../default-ownership-registry';
import { FilesystemArtifactStore } from '../filesystem-artifact-store';

function createStore(): { store: FilesystemArtifactStore; runDir: string } {
  const runDir = mkdtempSync(join(tmpdir(), 'fs-store-'));
  const ownership = new DefaultOwnershipRegistry();
  const validator = new DefaultArtifactTypeValidator();
  const store = new FilesystemArtifactStore(runDir, 'run-test', ownership, validator);
  return { store, runDir };
}

function validPlanContent(): string {
  return JSON.stringify({
    version: 1,
    specificationRef: {
      type: 'canonical_specification',
      name: 'spec',
      version: 1,
      checksum: 'sha256:abc',
    },
    createdAt: '2025-01-15T10:00:00Z',
    summary: 'Plan content here',
    tasks: [
      {
        taskId: 'task-1',
        description: 'Implement feature',
        files: ['src/main.ts'],
        dependencies: [],
      },
    ],
  });
}

function validInput(overrides?: Partial<ArtifactInput>): ArtifactInput {
  return {
    type: 'release_summary',
    name: 'test-artifact',
    content: 'test content',
    producedBy: 'summary_writer',
    preValidated: true,
    ...overrides,
  };
}

describe('FilesystemArtifactStore', () => {
  describe('store', () => {
    it('stores an artifact and returns a ref', async () => {
      const { store } = createStore();
      const ref = await store.store(validInput());

      expect(ref.type).toBe('release_summary');
      expect(ref.name).toBe('test-artifact');
      expect(ref.version).toBe(1);
      expect(ref.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('assigns sequential versions', async () => {
      const { store } = createStore();
      const ref1 = await store.store(validInput({ content: 'v1' }));
      const ref2 = await store.store(validInput({ content: 'v2' }));

      expect(ref1.version).toBe(1);
      expect(ref2.version).toBe(2);
    });

    it('rejects unauthorized producer', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'plan',
        producedBy: 'implementer',
        content: validPlanContent(),
      });

      await expect(store.store(input)).rejects.toThrow(OwnershipViolationError);
    });

    it('rejects invalid content for typed artifacts', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'plan',
        producedBy: 'planner',
        content: 'invalid content without frontmatter',
        preValidated: false,
      });

      await expect(store.store(input)).rejects.toThrow(TypeValidationError);
    });

    it('stores valid typed artifact', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'plan',
        producedBy: 'planner',
        name: 'plan',
        content: validPlanContent(),
      });
      const ref = await store.store(input);

      expect(ref.type).toBe('plan');
      expect(ref.version).toBe(1);
    });

    it('degrades malformed review artifact to stored with validationFailed metadata', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'plan_review',
        producedBy: 'plan_reviewer',
        name: 'review-1',
        content: 'malformed — no frontmatter at all',
        preValidated: false,
      });

      const ref = await store.store(input);
      expect(ref.type).toBe('plan_review');
      expect(ref.version).toBe(1);

      const artifact = await store.get(ref);
      expect(artifact.metadata?.['validationFailed']).toBe(true);
    });

    it('degrades malformed judge_decision artifact instead of throwing', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'judge_decision',
        producedBy: 'judge',
        name: 'judge-1',
        content: 'not valid YAML frontmatter',
        preValidated: false,
      });

      const ref = await store.store(input);
      expect(ref.type).toBe('judge_decision');

      const artifact = await store.get(ref);
      expect(artifact.metadata?.['validationFailed']).toBe(true);
    });

    it('degrades malformed verification artifact instead of throwing', async () => {
      const { store } = createStore();
      const input = validInput({
        type: 'verification',
        producedBy: 'verifier',
        name: 'verify-1',
        content: 'garbage content',
        preValidated: false,
      });

      const ref = await store.store(input);
      expect(ref.type).toBe('verification');

      const artifact = await store.get(ref);
      expect(artifact.metadata?.['validationFailed']).toBe(true);
    });
  });

  describe('get', () => {
    it('retrieves a stored artifact', async () => {
      const { store } = createStore();
      const content = 'get test content';
      const ref = await store.store(validInput({ content }));

      const artifact = await store.get(ref);
      expect(artifact.content).toBe(content);
      expect(artifact.ref).toEqual(ref);
      expect(artifact.type).toBe('release_summary');
    });

    it('throws ArtifactNotFoundError for missing artifact', async () => {
      const { store } = createStore();
      const missingRef = {
        type: 'release_summary' as const,
        name: 'missing',
        version: 1,
        checksum: 'sha256:000',
      };

      await expect(store.get(missingRef)).rejects.toThrow(ArtifactNotFoundError);
    });
  });

  describe('getLatest', () => {
    it('returns the latest version', async () => {
      const { store } = createStore();
      await store.store(validInput({ content: 'first' }));
      await store.store(validInput({ content: 'second' }));

      const latest = await store.getLatest('release_summary', 'test-artifact');
      expect(latest?.content).toBe('second');
      expect(latest?.version).toBe(2);
    });

    it('returns null when no versions exist', async () => {
      const { store } = createStore();
      const result = await store.getLatest('release_summary', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('lists artifacts matching query', async () => {
      const { store } = createStore();
      await store.store(validInput({ name: 'alpha', content: 'a' }));
      await store.store(validInput({ name: 'beta', content: 'b' }));

      const refs = await store.list({ type: 'release_summary', name: 'alpha' });
      expect(refs).toHaveLength(1);
      expect(refs[0]?.name).toBe('alpha');
    });

    it('filters by version range', async () => {
      const { store } = createStore();
      await store.store(validInput({ content: 'v1' }));
      await store.store(validInput({ content: 'v2' }));
      await store.store(validInput({ content: 'v3' }));

      const refs = await store.list({ minVersion: 2, maxVersion: 2 });
      expect(refs).toHaveLength(1);
      expect(refs[0]?.version).toBe(2);
    });
  });

  describe('history', () => {
    it('returns all versions in order', async () => {
      const { store } = createStore();
      await store.store(validInput({ content: 'v1' }));
      await store.store(validInput({ content: 'v2' }));
      await store.store(validInput({ content: 'v3' }));

      const hist = await store.history('release_summary', 'test-artifact');
      expect(hist).toHaveLength(3);
      expect(hist.map((r) => r.version)).toEqual([1, 2, 3]);
    });
  });

  describe('verify', () => {
    it('verifies integrity of a stored artifact', async () => {
      const { store } = createStore();
      const ref = await store.store(validInput({ content: 'verify me' }));

      const result = await store.verify(ref);
      expect(result.valid).toBe(true);
      expect(result.expectedChecksum).toBe(ref.checksum);
      expect(result.actualChecksum).toBe(ref.checksum);
    });

    it('detects tampered content', async () => {
      const { store, runDir } = createStore();
      const ref = await store.store(validInput({ content: 'original' }));

      const filePath = join(runDir, 'artifacts', 'release_summary', 'test-artifact_v1.md');
      writeFileSync(filePath, 'tampered');

      const result = await store.verify(ref);
      expect(result.valid).toBe(false);
      expect(result.actualChecksum).not.toBe(result.expectedChecksum);
    });
  });

  describe('inventory', () => {
    it('tracks all stored artifacts', async () => {
      const { store } = createStore();
      await store.store(validInput({ name: 'a', content: 'aaa' }));
      await store.store(validInput({ name: 'b', content: 'bbb' }));

      const inv = await store.inventory();
      expect(inv.runId).toBe('run-test');
      expect(inv.totalCount).toBe(2);
      expect(inv.totalSizeBytes).toBeGreaterThan(0);
    });
  });
});
