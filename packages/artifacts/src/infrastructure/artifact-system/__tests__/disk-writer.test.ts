import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactMetadata } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { DiskWriteError } from '../../../domain/artifact-system/errors';
import { atomicWrite, writeMetadata } from '../disk-writer';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'disk-writer-'));
}

describe('atomicWrite', () => {
  it('writes content to the target file', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'test.md');
    await atomicWrite(filePath, 'hello world');
    expect(readFileSync(filePath, 'utf8')).toBe('hello world');
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'nested', 'deep', 'file.md');
    await atomicWrite(filePath, 'nested content');
    expect(readFileSync(filePath, 'utf8')).toBe('nested content');
  });

  it('overwrites existing file content', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'overwrite.md');
    await atomicWrite(filePath, 'original');
    await atomicWrite(filePath, 'updated');
    expect(readFileSync(filePath, 'utf8')).toBe('updated');
  });

  it('does not leave temp files on success', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'clean.md');
    await atomicWrite(filePath, 'clean');

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.startsWith('.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('throws DiskWriteError for invalid paths', async () => {
    await expect(atomicWrite('/dev/null/impossible/path/file.md', 'content')).rejects.toThrow(
      DiskWriteError,
    );
  });

  it('handles empty content', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'empty.md');
    await atomicWrite(filePath, '');
    expect(readFileSync(filePath, 'utf8')).toBe('');
  });

  it('handles unicode content', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'unicode.md');
    const content = '日本語テスト 🎉 émojis';
    await atomicWrite(filePath, content);
    expect(readFileSync(filePath, 'utf8')).toBe(content);
  });
});

describe('writeMetadata', () => {
  it('writes metadata as YAML', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'plan_v1.meta.yaml');
    const metadata: ArtifactMetadata = {
      type: 'plan',
      name: 'plan',
      version: 1,
      checksum: 'sha256:abc123',
      producedBy: 'planner',
      predecessorRef: null,
      createdAt: '2025-01-15T10:30:00Z',
      sizeBytes: 100,
    };

    await writeMetadata(filePath, metadata);

    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('type: plan');
    expect(content).toContain('name: plan');
    expect(content).toContain('version: 1');
    expect(content).toContain('checksum: sha256:abc123');
    expect(content).toContain('producedBy: planner');
    expect(existsSync(filePath)).toBe(true);
  });
});
