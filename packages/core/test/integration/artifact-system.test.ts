import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OwnershipViolationError,
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
  InventoryManager,
} from '@ai-orchestrator/artifacts';
import type { ArtifactInput } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

function createTestStore(): { store: FilesystemArtifactStore; runDir: string } {
  const runDir = mkdtempSync(join(tmpdir(), 'artifact-integration-'));
  const ownership = new DefaultOwnershipRegistry();
  const validator = new DefaultArtifactTypeValidator();
  const store = new FilesystemArtifactStore(runDir, 'run-integration-test', ownership, validator);
  return { store, runDir };
}

function customInput(name: string, content: string): ArtifactInput {
  return {
    type: 'release_summary',
    name,
    content,
    producedBy: 'summary_writer',
    preValidated: true,
  };
}

function planInput(content: string, name = 'plan'): ArtifactInput {
  return { type: 'plan', name, content, producedBy: 'planner' };
}

function validPlanContent(version = 1): string {
  return JSON.stringify({
    version,
    specificationRef: {
      type: 'canonical_specification',
      name: 'spec',
      version: 1,
      checksum: 'sha256:abc',
    },
    createdAt: '2025-01-15T10:00:00Z',
    summary: `Plan v${String(version)}`,
    tasks: [
      {
        taskId: 'task-1',
        description: `Content for version ${String(version)}`,
        files: ['src/main.ts'],
        dependencies: [],
      },
    ],
  });
}

describe('Artifact System Integration', () => {
  describe('round-trip: store → get → verify', () => {
    it('stores, retrieves, and verifies content integrity', async () => {
      const { store } = createTestStore();
      const content = 'Round-trip test content with special chars: é, ñ, 日本語';

      const ref = await store.store(customInput('roundtrip', content));
      const artifact = await store.get(ref);
      expect(artifact.content).toBe(content);
      expect(artifact.ref).toEqual(ref);
      expect(artifact.sizeBytes).toBe(Buffer.byteLength(content, 'utf8'));

      const integrity = await store.verify(ref);
      expect(integrity.valid).toBe(true);
    });
  });

  describe('version chain', () => {
    it('stores v1, v2, v3 → history returns all → getLatest returns v3', async () => {
      const { store } = createTestStore();

      const ref1 = await store.store(customInput('doc', 'version 1'));
      const ref2 = await store.store(customInput('doc', 'version 2'));
      const ref3 = await store.store(customInput('doc', 'version 3'));

      expect(ref1.version).toBe(1);
      expect(ref2.version).toBe(2);
      expect(ref3.version).toBe(3);

      const hist = await store.history('release_summary', 'doc');
      expect(hist).toHaveLength(3);
      expect(hist.map((r) => r.version)).toEqual([1, 2, 3]);

      const latest = await store.getLatest('release_summary', 'doc');
      expect(latest?.version).toBe(3);
      expect(latest?.content).toBe('version 3');
    });
  });

  describe('ownership enforcement', () => {
    it('authorized store succeeds', async () => {
      const { store } = createTestStore();
      const ref = await store.store(planInput(validPlanContent()));
      expect(ref.type).toBe('plan');
      expect(ref.version).toBe(1);
    });

    it('unauthorized store returns OwnershipViolationError', async () => {
      const { store } = createTestStore();
      const input: ArtifactInput = {
        type: 'plan',
        name: 'plan',
        content: validPlanContent(),
        producedBy: 'implementer',
      };
      await expect(store.store(input)).rejects.toThrow(OwnershipViolationError);
    });
  });

  describe('integrity verification', () => {
    it('detects tampered file content', async () => {
      const { store, runDir } = createTestStore();
      const ref = await store.store(customInput('tamper-test', 'original content'));

      const filePath = join(runDir, 'artifacts', 'release_summary', 'tamper-test_v1.md');
      writeFileSync(filePath, 'tampered content');

      const result = await store.verify(ref);
      expect(result.valid).toBe(false);
      expect(result.actualChecksum).not.toBe(result.expectedChecksum);
    });
  });

  describe('inventory', () => {
    it('tracks all stored artifacts correctly', async () => {
      const { store } = createTestStore();

      await store.store(customInput('a', 'content a'));
      await store.store(customInput('b', 'content b'));
      await store.store(customInput('a', 'content a v2'));

      const inv = await store.inventory();
      expect(inv.runId).toBe('run-integration-test');
      expect(inv.totalCount).toBe(3);
      expect(inv.totalSizeBytes).toBeGreaterThan(0);
    });

    it('rebuilds inventory from disk', async () => {
      const { store, runDir } = createTestStore();

      await store.store(customInput('rebuild-a', 'content a'));
      await store.store(customInput('rebuild-b', 'content b'));

      const inventoryPath = join(runDir, 'inventory.yaml');
      writeFileSync(inventoryPath, 'corrupted');

      const mgr = new InventoryManager(runDir, 'run-integration-test');
      const rebuilt = await mgr.rebuild(join(runDir, 'artifacts'));
      expect(rebuilt.totalCount).toBe(2);
    });
  });

  describe('list and query', () => {
    it('filters by type and name', async () => {
      const { store } = createTestStore();

      await store.store(customInput('alpha', 'a'));
      await store.store(customInput('beta', 'b'));
      await store.store(customInput('alpha', 'a2'));

      const alphaRefs = await store.list({ type: 'release_summary', name: 'alpha' });
      expect(alphaRefs).toHaveLength(2);
      expect(alphaRefs.every((r) => r.name === 'alpha')).toBe(true);

      const betaRefs = await store.list({ type: 'release_summary', name: 'beta' });
      expect(betaRefs).toHaveLength(1);
    });
  });

  describe('typed artifact validation', () => {
    it('stores valid plan artifact', async () => {
      const { store } = createTestStore();
      const ref = await store.store(planInput(validPlanContent()));
      const artifact = await store.get(ref);
      expect(artifact.type).toBe('plan');
    });

    it('rejects plan with invalid frontmatter', async () => {
      const { store } = createTestStore();
      const input = planInput('no frontmatter here');
      await expect(store.store(input)).rejects.toThrow();
    });
  });
});
