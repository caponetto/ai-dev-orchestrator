import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactInput } from '@ai-dev-orchestrator/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';

import { InventoryCorruptionError } from '../../../domain/artifact-system/errors';
import { DefaultArtifactTypeValidator } from '../artifact-type-validator';
import { computeChecksum } from '../checksum-engine';
import { DefaultOwnershipRegistry } from '../default-ownership-registry';
import * as diskWriter from '../disk-writer';
import { FilesystemArtifactStore } from '../filesystem-artifact-store';
import { InventoryManager } from '../inventory-manager';

const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'artifact-recovery-'));
  dirs.push(root);
  const create = () =>
    new FilesystemArtifactStore(
      root,
      'run',
      new DefaultOwnershipRegistry(),
      new DefaultArtifactTypeValidator(),
    );
  return { root, create, store: create() };
}
const input: ArtifactInput = {
  type: 'release_summary',
  name: 'summary',
  runId: 'run',
  content: 'first',
  producedBy: 'summary_writer',
  preValidated: true,
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('artifact write recovery', () => {
  it.each(['before-content', 'after-content', 'after-metadata', 'after-inventory'] as const)(
    'finishes the same version after %s failure without another store call',
    async (window) => {
      const { root, create, store } = setup();
      const first = await store.store(input);
      const write = diskWriter.atomicWrite;
      const metadata = diskWriter.writeMetadata;
      const manager = new InventoryManager(root, 'run');
      const add = manager.addEntry.bind(manager);
      if (window === 'after-metadata') {
        vi.spyOn(diskWriter, 'writeMetadata').mockImplementation(async (...args) => {
          await metadata(...args);
          throw new Error('injected interruption');
        });
      } else if (window === 'after-inventory') {
        vi.spyOn(InventoryManager.prototype, 'addEntry').mockImplementation(async (entry) => {
          await add(entry);
          throw new Error('injected interruption');
        });
      } else {
        vi.spyOn(diskWriter, 'atomicWrite').mockImplementation(async (path, content) => {
          if (path.endsWith('summary_v2.md') && window === 'before-content') {
            throw new Error('injected interruption');
          }
          await write(path, content);
          if (path.endsWith('summary_v2.md')) {
            throw new Error('injected interruption');
          }
        });
      }
      await expect(store.store({ ...input, content: 'second 🎉' })).rejects.toThrow(
        'injected interruption',
      );
      expect(existsSync(join(root, 'artifacts', '.pending-write.yaml'))).toBe(true);
      vi.restoreAllMocks();
      const restored = create();
      const expected = [first, { ...first, version: 2, checksum: computeChecksum('second 🎉') }];
      expect(await restored.list({})).toEqual(expected);
      expect(await restored.history(input.type, input.name)).toEqual(expected);
      expect((await restored.getLatest(input.type, input.name))?.content).toBe('second 🎉');
      expect((await restored.inventory()).artifacts.map((entry) => entry.ref)).toEqual(expected);
      expect(existsSync(join(root, 'artifacts', '.pending-write.yaml'))).toBe(false);
      expect((await restored.store({ ...input, content: 'third' })).version).toBe(3);
    },
  );

  it('keeps legacy partial files out of committed reads and reserves their versions', async () => {
    const { root, store } = setup();
    const first = await store.store(input);
    const dir = join(root, 'artifacts', input.type);
    writeFileSync(join(dir, 'summary_v2.md'), 'orphan content');
    writeFileSync(join(dir, 'summary_v3.meta.yaml'), 'orphan metadata');
    expect(await store.list({})).toEqual([first]);
    expect(await store.history(input.type, input.name)).toEqual([first]);
    expect((await store.getLatest(input.type, input.name))?.ref).toEqual(first);
    expect((await store.store({ ...input, content: 'fourth' })).version).toBe(4);
    expect(readFileSync(join(dir, 'summary_v3.meta.yaml'), 'utf8')).toBe('orphan metadata');
  });

  it.each(['missing-content', 'checksum', 'size', 'identity', 'schema'])(
    'rejects %s on rebuild without replacing the previous inventory',
    async (failure) => {
      const { root, store } = setup();
      const first = await store.store(input);
      const inventory = readFileSync(join(root, 'inventory.yaml'), 'utf8');
      const dir = join(root, 'artifacts', input.type);
      const original = parse(readFileSync(join(dir, 'summary_v1.meta.yaml'), 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(join(dir, 'summary_v2.md'), 'second');
      writeFileSync(
        join(dir, 'summary_v2.meta.yaml'),
        stringify({
          ...original,
          version: 2,
          checksum: computeChecksum('second'),
          sizeBytes: 6,
          ...(failure === 'checksum' ? { checksum: 'wrong' } : {}),
          ...(failure === 'size' ? { sizeBytes: 5 } : {}),
          ...(failure === 'identity' ? { name: 'different' } : {}),
          ...(failure === 'schema' ? { producedBy: null } : {}),
        }),
      );
      if (failure === 'missing-content') {
        rmSync(join(dir, 'summary_v2.md'));
      }
      await expect(
        new InventoryManager(root, 'run').rebuild(join(root, 'artifacts')),
      ).rejects.toThrow(InventoryCorruptionError);
      expect(readFileSync(join(root, 'inventory.yaml'), 'utf8')).toBe(inventory);
      expect(await store.list({})).toEqual([first]);
    },
  );
});

describe('pending write integrity and retry', () => {
  async function prepare() {
    const h = setup();
    vi.spyOn(diskWriter, 'writeMetadata').mockRejectedValue(new Error('metadata unavailable'));
    await expect(h.store.store(input)).rejects.toThrow('metadata unavailable');
    vi.restoreAllMocks();
    const path = join(h.root, 'artifacts', '.pending-write.yaml');
    const raw = readFileSync(path, 'utf8');
    const pending = parse(raw) as {
      runId: string;
      content: string;
      metadata: Record<string, unknown>;
    };
    return { ...h, path, raw, pending };
  }

  it.each(['yaml', 'schema', 'run', 'metadata-run', 'checksum', 'size', 'path', 'version'])(
    'rejects a damaged pending record (%s) without changing existing files',
    async (failure) => {
      const h = await prepare();
      if (failure === 'metadata-run') {
        h.pending.metadata['runId'] = 'another-run';
      }
      if (failure === 'run') {
        h.pending.runId = 'another-run';
      }
      if (failure === 'checksum') {
        h.pending.metadata['checksum'] = 'wrong';
      }
      if (failure === 'size') {
        h.pending.metadata['sizeBytes'] = 99;
      }
      if (failure === 'path') {
        h.pending.metadata['name'] = '../escape';
      }
      if (failure === 'version') {
        h.pending.metadata['version'] = 1.5;
      }
      const bad = failure === 'yaml' ? '{{' : failure === 'schema' ? 'null' : stringify(h.pending);
      writeFileSync(h.path, bad);
      await expect(h.create().list({})).rejects.toThrow(InventoryCorruptionError);
      expect(readFileSync(h.path, 'utf8')).toBe(bad);
      expect(existsSync(join(h.root, 'inventory.yaml'))).toBe(false);
      // Restoring trusted evidence permits a retry; failure did not poison the operation queue.
      writeFileSync(h.path, h.raw);
      expect(await h.store.list({})).toHaveLength(1);
    },
  );

  it.each(['content', 'metadata', 'inventory', 'inventory-producer'])(
    'retains conflicting %s and the pending record until explicitly reconciled',
    async (failure) => {
      const h = await prepare();
      const artifactDir = join(h.root, 'artifacts', input.type);
      const contentPath = join(artifactDir, 'summary_v1.md');
      const metaPath = join(artifactDir, 'summary_v1.meta.yaml');
      if (failure === 'content') {
        writeFileSync(contentPath, 'different output');
      }
      if (failure === 'metadata') {
        writeFileSync(metaPath, stringify({ ...h.pending.metadata, producedBy: 'different' }));
      }
      if (failure === 'inventory' || failure === 'inventory-producer') {
        await new InventoryManager(h.root, 'run').addEntry({
          ref: {
            type: input.type,
            name: input.name,
            version: 1,
            checksum: failure === 'inventory' ? 'different' : computeChecksum(input.content),
          },
          type: input.type,
          name: input.name,
          version: 1,
          producedBy: 'different',
          createdAt: String(h.pending.metadata['createdAt']),
          sizeBytes: Buffer.byteLength(input.content, 'utf8'),
        });
      }
      await expect(h.create().inventory()).rejects.toThrow('conflict');
      expect(readFileSync(h.path, 'utf8')).toBe(h.raw);
      if (failure === 'content') {
        expect(readFileSync(contentPath, 'utf8')).toBe('different output');
        writeFileSync(contentPath, input.content);
      }
      if (failure === 'metadata') {
        expect(readFileSync(metaPath, 'utf8')).toContain('different');
        rmSync(metaPath);
      }
      if (failure === 'inventory' || failure === 'inventory-producer') {
        rmSync(join(h.root, 'inventory.yaml'));
      }
      expect(await h.create().list({})).toHaveLength(1);
    },
  );

  it('requires pending recovery before an explicit inventory rebuild', async () => {
    const h = await prepare();
    await expect(
      new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts')),
    ).rejects.toThrow('Pending artifact write');
    expect(readFileSync(h.path, 'utf8')).toBe(h.raw);
    await h.create().inventory();
    expect(
      (await new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts'))).totalCount,
    ).toBe(1);
  });

  it('does not leave an intent or poison later writes if preparing the record fails', async () => {
    const h = setup();
    const first = await h.store.store(input);
    const write = diskWriter.atomicWrite;
    vi.spyOn(diskWriter, 'atomicWrite').mockImplementation(async (path, content) => {
      if (path.endsWith('.pending-write.yaml')) {
        throw new Error('intent unavailable');
      }
      await write(path, content);
    });
    await expect(h.store.store({ ...input, content: 'second' })).rejects.toThrow(
      'intent unavailable',
    );
    vi.restoreAllMocks();
    expect(await h.store.list({})).toEqual([first]);
    expect(existsSync(join(h.root, 'artifacts', '.pending-write.yaml'))).toBe(false);
    expect((await h.store.store({ ...input, content: 'retry' })).version).toBe(2);
  });

  it('serializes readers and another store behind a blocked write', async () => {
    const h = setup();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const metadata = diskWriter.writeMetadata;
    vi.spyOn(diskWriter, 'writeMetadata').mockImplementationOnce(async (...args) => {
      entered();
      await blocked;
      await metadata(...args);
    });
    const write = h.store.store(input);
    await started;
    let observed = false;
    const other = h.create();
    const read = other.list({}).then((refs) => {
      observed = true;
      return refs;
    });
    await Promise.resolve();
    expect(observed).toBe(false);
    release();
    const ref = await write;
    expect(await read).toEqual([ref]);
    expect((await other.get(ref)).content).toBe(input.content);
    expect((await other.verify(ref)).valid).toBe(true);
  });
});

describe('explicit inventory reconciliation', () => {
  it('initializes an empty inventory when no artifact directory or prior index exists', async () => {
    const h = setup();
    expect(
      (await new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts'))).artifacts,
    ).toEqual([]);
  });

  it.each(['{{', 'null'])('rejects malformed sidecars during exact reads: %s', async (raw) => {
    const h = setup();
    const ref = await h.store.store(input);
    const path = join(h.root, 'artifacts', input.type, 'summary_v1.meta.yaml');
    writeFileSync(path, raw);
    await expect(h.store.get(ref)).rejects.toThrow(InventoryCorruptionError);
    expect(readFileSync(path, 'utf8')).toBe(raw);
  });

  it('preserves the inventory when the entire artifact directory is missing', async () => {
    const h = setup();
    await h.store.store(input);
    const inventory = readFileSync(join(h.root, 'inventory.yaml'), 'utf8');
    rmSync(join(h.root, 'artifacts'), { recursive: true });
    await expect(
      new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts')),
    ).rejects.toThrow(InventoryCorruptionError);
    expect(readFileSync(join(h.root, 'inventory.yaml'), 'utf8')).toBe(inventory);
  });

  it('rebuilds complete legacy pairs while retaining content-only remnants outside the index', async () => {
    const h = setup();
    const ref = await h.store.store(input);
    const dir = join(h.root, 'artifacts', input.type);
    const metaPath = join(dir, 'summary_v1.meta.yaml');
    const meta = parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    delete meta['predecessorRef'];
    writeFileSync(metaPath, stringify(meta));
    writeFileSync(join(dir, 'summary_v2.md'), 'legacy incomplete output');
    rmSync(join(h.root, 'inventory.yaml'));
    expect(
      (await new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts'))).artifacts.map(
        (entry) => entry.ref,
      ),
    ).toEqual([ref]);
    expect(await h.store.history(input.type, input.name)).toEqual([ref]);
    expect(readFileSync(join(dir, 'summary_v2.md'), 'utf8')).toBe('legacy incomplete output');
  });

  it.each(['run', 'filename', 'version', 'negative-size'])(
    'rejects invalid %s in sidecars without publishing a rebuilt index',
    async (failure) => {
      const h = setup();
      await h.store.store(input);
      const dir = join(h.root, 'artifacts', input.type);
      const path = join(dir, 'summary_v1.meta.yaml');
      const meta = parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      if (failure === 'run') {
        meta['runId'] = 'other-run';
      }
      if (failure === 'version') {
        meta['version'] = 1.5;
      }
      if (failure === 'negative-size') {
        meta['sizeBytes'] = -1;
      }
      writeFileSync(path, stringify(meta));
      if (failure === 'filename') {
        writeFileSync(join(dir, 'summary_v01.meta.yaml'), stringify(meta));
        rmSync(path);
      }
      const before = readFileSync(join(h.root, 'inventory.yaml'), 'utf8');
      await expect(
        new InventoryManager(h.root, 'run').rebuild(join(h.root, 'artifacts')),
      ).rejects.toThrow(InventoryCorruptionError);
      expect(readFileSync(join(h.root, 'inventory.yaml'), 'utf8')).toBe(before);
    },
  );
});

describe('invalid prepared write input', () => {
  it.each([{ name: '../outside' }, { runId: 'another-run' }])(
    'rejects invalid identity before writing a recovery record: %j',
    async (invalid) => {
      const h = setup();
      await expect(h.store.store({ ...input, ...invalid })).rejects.toThrow();
      expect(existsSync(join(h.root, 'artifacts', '.pending-write.yaml'))).toBe(false);
      expect((await h.store.store(input)).version).toBe(1);
    },
  );
});
