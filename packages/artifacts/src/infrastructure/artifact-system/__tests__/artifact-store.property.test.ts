import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DefaultArtifactTypeValidator } from '../artifact-type-validator';
import { computeChecksum } from '../checksum-engine';
import { DefaultOwnershipRegistry } from '../default-ownership-registry';
import { FilesystemArtifactStore } from '../filesystem-artifact-store';

function createStore(): FilesystemArtifactStore {
  const runDir = mkdtempSync(join(tmpdir(), 'prop-test-'));
  return new FilesystemArtifactStore(
    runDir,
    'run-property-test',
    new DefaultOwnershipRegistry(),
    new DefaultArtifactTypeValidator(),
  );
}

describe('Artifact Store Property Tests', () => {
  it('stored artifact is always retrievable with matching content', async () => {
    const store = createStore();
    const contents = [
      'simple content',
      'content with newlines\n\nmultiple\nlines',
      'unicode: 日本語テスト 🎉 émojis',
      '',
      'x'.repeat(10_000),
    ];

    for (const content of contents) {
      const ref = await store.store({
        type: 'release_summary',
        name: 'prop-test',
        content,
        producedBy: 'summary_writer',
        preValidated: true,
      });

      const artifact = await store.get(ref);
      expect(artifact.content).toBe(content);
    }
  });

  it(
    'storing N artifacts with the same name produces strictly increasing versions',
    { timeout: 30_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.array(fc.string({ minLength: 0, maxLength: 100 }), { minLength: 2, maxLength: 5 }),
          async (_, contents) => {
            const store = createStore();
            const refs = [];

            for (const content of contents) {
              const ref = await store.store({
                type: 'release_summary',
                name: 'versioned-prop',
                content,
                producedBy: 'summary_writer',
                preValidated: true,
              });
              refs.push(ref);
            }

            for (let i = 1; i < refs.length; i++) {
              expect(refs[i].version).toBeGreaterThan(refs[i - 1].version);
              expect(refs[i].version).toBe(refs[i - 1].version + 1);
            }
          },
        ),
        { numRuns: 10 },
      );
    },
  );

  it('checksum always matches content on fresh store', async () => {
    const store = createStore();
    const contents = ['checksum test 1', 'checksum test 2', 'special chars: <>&"\''];

    for (const content of contents) {
      const ref = await store.store({
        type: 'release_summary',
        name: 'checksum-prop',
        content,
        producedBy: 'summary_writer',
        preValidated: true,
      });

      expect(ref.checksum).toBe(computeChecksum(content));

      const integrity = await store.verify(ref);
      expect(integrity.valid).toBe(true);
    }
  });

  it('inventory count equals artifact count on disk', async () => {
    const store = createStore();
    const expectedCount = 7;

    for (let i = 0; i < expectedCount; i++) {
      await store.store({
        type: 'release_summary',
        name: `item-${String(i)}`,
        content: `content ${String(i)}`,
        producedBy: 'summary_writer',
        preValidated: true,
      });
    }

    const inv = await store.inventory();
    expect(inv.totalCount).toBe(expectedCount);
    expect(inv.artifacts).toHaveLength(expectedCount);
  });

  it('history returns all versions for an artifact name', async () => {
    const store = createStore();
    const versionCount = 4;

    for (let i = 0; i < versionCount; i++) {
      await store.store({
        type: 'release_summary',
        name: 'versioned',
        content: `version ${String(i + 1)}`,
        producedBy: 'summary_writer',
        preValidated: true,
      });
    }

    const hist = await store.history('release_summary', 'versioned');
    expect(hist).toHaveLength(versionCount);
    expect(hist.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });
});
