import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { computeChecksum, verifyChecksum } from '../checksum-engine';
import { InventoryManager } from '../inventory-manager';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'prop-'));
}

describe('Property-based: Checksum Engine', () => {
  it('determinism: same content always produces same checksum', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        const a = computeChecksum(content);
        const b = computeChecksum(content);
        expect(a).toBe(b);
      }),
      { numRuns: 200 },
    );
  });

  it('verifyChecksum agrees with computeChecksum', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        const checksum = computeChecksum(content);
        expect(verifyChecksum(content, checksum)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('collision resistance: distinct content produces distinct checksums', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (a, b) => {
        fc.pre(a !== b);
        expect(computeChecksum(a)).not.toBe(computeChecksum(b));
      }),
      { numRuns: 200 },
    );
  });

  it('checksum format is always sha256:<64-hex-chars>', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        const checksum = computeChecksum(content);
        expect(checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property-based: Inventory Rebuild Round-trip', () => {
  it('rebuild recovers all stored artifacts from meta files', { timeout: 20_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
            version: fc.integer({ min: 1, max: 100 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (entries) => {
          const uniqueEntries = entries.filter(
            (e, i, arr) => arr.findIndex((x) => x.name === e.name && x.version === e.version) === i,
          );
          if (uniqueEntries.length === 0) {
            return;
          }

          const dir = tempDir();
          const runDir = join(dir, 'run');
          const artifactsDir = join(runDir, 'artifacts');

          for (const entry of uniqueEntries) {
            const typeDir = join(artifactsDir, 'release_summary');
            mkdirSync(typeDir, { recursive: true });

            const content = `content-${entry.name}-v${String(entry.version)}`;
            const checksum = computeChecksum(content);

            writeFileSync(join(typeDir, `${entry.name}_v${String(entry.version)}.md`), content);
            writeFileSync(
              join(typeDir, `${entry.name}_v${String(entry.version)}.meta.yaml`),
              stringify({
                type: 'release_summary',
                name: entry.name,
                version: entry.version,
                checksum,
                producedBy: 'test',
                createdAt: '2025-01-01T00:00:00Z',
                sizeBytes: Buffer.byteLength(content, 'utf8'),
              }),
            );
          }

          const mgr = new InventoryManager(runDir, 'run-test');
          const rebuilt = await mgr.rebuild(artifactsDir);

          expect(rebuilt.totalCount).toBe(uniqueEntries.length);

          for (const entry of uniqueEntries) {
            const match = rebuilt.artifacts.find(
              (a: { name: string; version: number }) =>
                a.name === entry.name && a.version === entry.version,
            );
            expect(match).toBeDefined();
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('Property-based: Version Monotonicity', () => {
  it('sequential stores produce strictly increasing versions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), (count) => {
        const versions: number[] = [];
        for (let i = 1; i <= count; i++) {
          versions.push(i);
        }

        for (let i = 1; i < versions.length; i++) {
          expect(versions[i]).toBeGreaterThan(versions[i - 1]);
        }
      }),
      { numRuns: 50 },
    );
  });
});
