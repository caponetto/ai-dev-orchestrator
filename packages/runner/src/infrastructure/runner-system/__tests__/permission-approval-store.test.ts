import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { FileBackedPermissionApprovalStore } from '../permission-approval-store';

describe('FileBackedPermissionApprovalStore', () => {
  let testDir: string;
  let filePath: string;
  let store: FileBackedPermissionApprovalStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `approval-store-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    filePath = join(testDir, 'permission-approvals.json');
    store = new FileBackedPermissionApprovalStore(filePath);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('record', () => {
    it('creates file and stores a new approval entry', async () => {
      await store.record({
        action: 'shell_execute',
        resource: 'npm test',
        detail: 'Run tests',
        createdByRole: 'implementer',
      });

      expect(existsSync(filePath)).toBe(true);
      const entries = store.list();
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry).toBeDefined();
      expect(entry.action).toBe('shell_execute');
      expect(entry.resource).toBe('npm test');
      expect(entry.detail).toBe('Run tests');
      expect(entry.createdByRole).toBe('implementer');
      expect(entry.id).toBeDefined();
      expect(entry.createdAt).toBeDefined();
    });

    it('de-duplicates entries with same action and resource', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });
      await store.record({ action: 'shell_execute', resource: 'npm test' });

      expect(store.list()).toHaveLength(1);
    });

    it('allows different actions on same resource', async () => {
      await store.record({ action: 'shell_execute', resource: '/path/file.ts' });
      await store.record({ action: 'file_write', resource: '/path/file.ts' });

      expect(store.list()).toHaveLength(2);
    });
  });

  describe('findMatch', () => {
    it('returns undefined when no approvals exist', async () => {
      await store.reload();
      expect(store.findMatch('shell_execute', 'npm test')).toBeUndefined();
    });

    it('matches exact resource string', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });

      const match = store.findMatch('shell_execute', 'npm test');
      expect(match).toBeDefined();
      expect(match?.resource).toBe('npm test');
    });

    it('matches by prefix', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });

      const match = store.findMatch('shell_execute', 'npm test -- --coverage');
      expect(match).toBeDefined();
      expect(match?.resource).toBe('npm test');
    });

    it('does not match different actions', async () => {
      await store.record({ action: 'file_write', resource: '/src/foo.ts' });

      expect(store.findMatch('shell_execute', '/src/foo.ts')).toBeUndefined();
    });

    it('does not match non-prefix strings', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm run build' });

      expect(store.findMatch('shell_execute', 'npm test')).toBeUndefined();
    });

    it('matches file paths by prefix', async () => {
      await store.record({ action: 'file_write', resource: '/Users/dev/proj/src' });

      const match = store.findMatch('file_write', '/Users/dev/proj/src/components/App.tsx');
      expect(match).toBeDefined();
    });
  });

  describe('remove', () => {
    it('removes an entry by id', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });
      const entries = store.list();
      expect(entries).toHaveLength(1);

      const id = entries[0]?.id ?? '';
      const removed = await store.remove(id);
      expect(removed).toBe(true);
      expect(store.list()).toHaveLength(0);
    });

    it('returns false for non-existent id', async () => {
      await store.reload();
      const removed = await store.remove('non-existent-id');
      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });
      await store.record({ action: 'file_write', resource: '/path' });
      expect(store.list()).toHaveLength(2);

      await store.clear();
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('survives reload from disk', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });

      const store2 = new FileBackedPermissionApprovalStore(filePath);
      await store2.reload();
      expect(store2.list()).toHaveLength(1);
      expect(store2.list()[0]?.resource).toBe('npm test');
    });

    it('handles corrupted file gracefully', async () => {
      writeFileSync(filePath, 'not valid json');

      const store2 = new FileBackedPermissionApprovalStore(filePath);
      await store2.reload();
      expect(store2.list()).toHaveLength(0);
    });

    it('handles missing file gracefully', async () => {
      const store2 = new FileBackedPermissionApprovalStore(join(testDir, 'nonexistent.json'));
      await store2.reload();
      expect(store2.list()).toHaveLength(0);
    });

    it('writes valid JSON with version field', async () => {
      await store.record({ action: 'shell_execute', resource: 'npm test' });

      const content = JSON.parse(readFileSync(filePath, 'utf-8')) as {
        version: number;
        approvals: unknown[];
      };
      expect(content.version).toBe(1);
      expect(content.approvals).toHaveLength(1);
    });
  });

  describe('pre-cache behavior', () => {
    it('findMatch returns undefined on a fresh store without reload', () => {
      const freshStore = new FileBackedPermissionApprovalStore(filePath);
      // No reload or record called -- cache is null
      const match = freshStore.findMatch('shell_execute', 'npm test');
      expect(match).toBeUndefined();
    });

    it('list returns empty array on a fresh store without reload', () => {
      const freshStore = new FileBackedPermissionApprovalStore(filePath);
      // No reload or record called -- cache is null
      const entries = freshStore.list();
      expect(entries).toEqual([]);
    });

    it('remove on fresh store initializes cache and returns false for unknown id', async () => {
      const freshStore = new FileBackedPermissionApprovalStore(
        join(testDir, 'fresh-approvals.json'),
      );
      // No reload -- ensureLoaded will initialize from missing file
      const removed = await freshStore.remove('nonexistent-id');
      expect(removed).toBe(false);
    });
  });

  describe('ensureLoaded edge cases', () => {
    it('parses file with valid JSON but invalid schema as empty', async () => {
      // Write valid JSON that does not match the permissionApprovalFileSchema
      writeFileSync(filePath, JSON.stringify({ version: 999, bad: 'data' }));

      const freshStore = new FileBackedPermissionApprovalStore(filePath);
      await freshStore.reload();
      expect(freshStore.list()).toHaveLength(0);
    });
  });
});
