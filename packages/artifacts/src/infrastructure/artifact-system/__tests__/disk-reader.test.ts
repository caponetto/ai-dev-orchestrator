import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactRef } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ArtifactNotFoundError } from '../../../domain/artifact-system/errors';
import { fileExists, readContent, readMetadata } from '../disk-reader';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'disk-reader-'));
}

const sampleRef: ArtifactRef = {
  type: 'plan',
  name: 'plan',
  version: 1,
  checksum: 'sha256:abc',
};

describe('readContent', () => {
  it('reads file content', () => {
    const dir = tempDir();
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, 'artifact content');
    expect(readContent(filePath, sampleRef)).toBe('artifact content');
  });

  it('throws ArtifactNotFoundError for missing file', () => {
    expect(() => {
      readContent('/nonexistent/path.md', sampleRef);
    }).toThrow(ArtifactNotFoundError);
  });

  it('reads unicode content', () => {
    const dir = tempDir();
    const filePath = join(dir, 'unicode.md');
    const content = '日本語テスト 🎉';
    writeFileSync(filePath, content);
    expect(readContent(filePath, sampleRef)).toBe(content);
  });

  it('reads empty file', () => {
    const dir = tempDir();
    const filePath = join(dir, 'empty.md');
    writeFileSync(filePath, '');
    expect(readContent(filePath, sampleRef)).toBe('');
  });
});

describe('readMetadata', () => {
  it('parses YAML metadata', () => {
    const dir = tempDir();
    const filePath = join(dir, 'meta.yaml');
    writeFileSync(
      filePath,
      'type: plan\nname: plan\nversion: 1\nchecksum: "sha256:abc"\nproducedBy: planner\npredecessorRef: null\ncreatedAt: "2025-01-15T10:30:00Z"\nsizeBytes: 100\n',
    );

    const meta = readMetadata(filePath, sampleRef);
    expect(meta.type).toBe('plan');
    expect(meta.name).toBe('plan');
    expect(meta.version).toBe(1);
    expect(meta.checksum).toBe('sha256:abc');
    expect(meta.producedBy).toBe('planner');
    expect(meta.predecessorRef).toBeNull();
    expect(meta.sizeBytes).toBe(100);
  });

  it('throws ArtifactNotFoundError for missing metadata file', () => {
    expect(() => {
      readMetadata('/nonexistent/meta.yaml', sampleRef);
    }).toThrow(ArtifactNotFoundError);
  });
});

describe('fileExists', () => {
  it('returns true for existing file', () => {
    const dir = tempDir();
    const filePath = join(dir, 'exists.txt');
    writeFileSync(filePath, 'data');
    expect(fileExists(filePath)).toBe(true);
  });

  it('returns false for non-existing file', () => {
    expect(fileExists('/nonexistent/file.txt')).toBe(false);
  });
});
