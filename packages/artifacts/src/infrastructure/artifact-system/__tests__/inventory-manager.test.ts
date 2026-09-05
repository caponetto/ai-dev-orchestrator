import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactSummary } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { InventoryManager } from '../inventory-manager';

function tempRunDir(): string {
  return mkdtempSync(join(tmpdir(), 'inv-mgr-'));
}

function makeSummary(type: string, name: string, version: number): ArtifactSummary {
  return {
    ref: {
      type: type as ArtifactSummary['type'],
      name,
      version,
      checksum: `sha256:${type}-${name}-v${String(version)}`,
    },
    type: type as ArtifactSummary['type'],
    name,
    version,
    producedBy: 'test-role',
    createdAt: '2025-01-15T10:00:00Z',
    sizeBytes: 100,
  };
}

describe('InventoryManager', () => {
  it('starts with empty inventory', () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    const inv = mgr.getInventory();
    expect(inv.runId).toBe('run-test');
    expect(inv.totalCount).toBe(0);
    expect(inv.artifacts).toEqual([]);
  });

  it('adds entries and updates counts', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    await mgr.addEntry(makeSummary('plan', 'plan', 1));
    await mgr.addEntry(makeSummary('plan', 'plan', 2));

    const inv = mgr.getInventory();
    expect(inv.totalCount).toBe(2);
    expect(inv.totalSizeBytes).toBe(200);
  });

  it('removes entries', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    const summary = makeSummary('plan', 'plan', 1);
    await mgr.addEntry(summary);
    await mgr.removeEntry(summary.ref);

    expect(mgr.getInventory().totalCount).toBe(0);
  });

  it('persists to inventory.yaml on add', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    await mgr.addEntry(makeSummary('plan', 'plan', 1));

    const inventoryPath = join(dir, 'inventory.yaml');
    expect(existsSync(inventoryPath)).toBe(true);

    const data = parse(readFileSync(inventoryPath, 'utf8')) as { totalCount: number };
    expect(data.totalCount).toBe(1);
  });

  it('loads existing inventory from disk', async () => {
    const dir = tempRunDir();
    const mgr1 = new InventoryManager(dir, 'run-test');
    await mgr1.addEntry(makeSummary('plan', 'plan', 1));
    await mgr1.addEntry(makeSummary('implementation', 'impl', 1));

    const mgr2 = new InventoryManager(dir, 'run-test');
    expect(mgr2.getInventory().totalCount).toBe(2);
  });

  it('lists refs with type filter', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    await mgr.addEntry(makeSummary('plan', 'plan', 1));
    await mgr.addEntry(makeSummary('implementation', 'impl', 1));

    const planRefs = mgr.listRefs({ type: 'plan' });
    expect(planRefs).toHaveLength(1);
    expect(planRefs[0]?.type).toBe('plan');
  });

  it('lists refs with name filter', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    await mgr.addEntry(makeSummary('plan', 'alpha', 1));
    await mgr.addEntry(makeSummary('plan', 'beta', 1));

    const refs = mgr.listRefs({ name: 'alpha' });
    expect(refs).toHaveLength(1);
  });

  it('rebuilds from disk', async () => {
    const dir = tempRunDir();
    const artifactsDir = join(dir, 'artifacts');
    const planDir = join(artifactsDir, 'plan');
    mkdirSync(planDir, { recursive: true });

    writeFileSync(
      join(planDir, 'plan_v1.meta.yaml'),
      'type: plan\nname: plan\nversion: 1\nchecksum: "sha256:abc"\nproducedBy: planner\npredecessorRef: null\ncreatedAt: "2025-01-15T10:00:00Z"\nsizeBytes: 50\n',
    );
    writeFileSync(join(planDir, 'plan_v1.md'), 'plan content');

    const mgr = new InventoryManager(dir, 'run-test');
    const inv = await mgr.rebuild(artifactsDir);

    expect(inv.totalCount).toBe(1);
    expect(inv.artifacts[0]?.type).toBe('plan');
    expect(inv.artifacts[0]?.version).toBe(1);
  });

  it('persists ref as a nested object in inventory.yaml', async () => {
    const dir = tempRunDir();
    const mgr = new InventoryManager(dir, 'run-test');
    await mgr.addEntry(makeSummary('plan', 'plan', 1));

    const inventoryPath = join(dir, 'inventory.yaml');
    const data = parse(readFileSync(inventoryPath, 'utf8')) as {
      artifacts: Array<{ ref?: { type: string; checksum: string } }>;
    };
    expect(data.artifacts[0]?.ref).toBeDefined();
    expect(data.artifacts[0]?.ref?.type).toBe('plan');
    expect(data.artifacts[0]?.ref?.checksum).toBe('sha256:plan-plan-v1');
  });

  it('loads legacy flat-format inventory without ref key', () => {
    const dir = tempRunDir();
    const inventoryPath = join(dir, 'inventory.yaml');
    const legacyYaml = [
      'runId: run-test',
      'updatedAt: "2025-01-15T10:00:00Z"',
      'totalCount: 1',
      'totalSizeBytes: 100',
      'artifacts:',
      '  - type: plan',
      '    name: plan',
      '    version: 1',
      '    checksum: "sha256:legacy"',
      '    producedBy: planner',
      '    createdAt: "2025-01-15T10:00:00Z"',
      '    sizeBytes: 100',
    ].join('\n');
    writeFileSync(inventoryPath, legacyYaml);

    const mgr = new InventoryManager(dir, 'run-test');
    const inv = mgr.getInventory();
    expect(inv.totalCount).toBe(1);
    expect(inv.artifacts[0]?.ref.type).toBe('plan');
    expect(inv.artifacts[0]?.ref.checksum).toBe('sha256:legacy');
  });
});
