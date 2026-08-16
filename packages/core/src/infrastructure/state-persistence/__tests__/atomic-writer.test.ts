import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteState } from '../atomic-writer';

const TEST_DIR = join(tmpdir(), `state-persistence-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('atomicWriteState', () => {
  it('writes content to the target file', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'runId: run-001');
    expect(readFileSync(filePath, 'utf8')).toBe('runId: run-001');
  });

  it('creates parent directories if needed', async () => {
    const filePath = join(TEST_DIR, 'nested', 'deep', 'state.yaml');
    await atomicWriteState(filePath, 'data');
    expect(existsSync(filePath)).toBe(true);
  });

  it('overwrites existing files', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'version: 1');
    await atomicWriteState(filePath, 'version: 2');
    expect(readFileSync(filePath, 'utf8')).toBe('version: 2');
  });

  it('leaves no temp files on success', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'data');
    const files = readdirSync(TEST_DIR);
    const tmpFiles = files.filter((f) => f.startsWith('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('creates .bak file from previous content on write', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'first-content');
    await atomicWriteState(filePath, 'second-content');

    expect(readFileSync(filePath, 'utf8')).toBe('second-content');
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('first-content');
  });

  it('rotates backup on successive writes', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'v1');
    await atomicWriteState(filePath, 'v2');
    await atomicWriteState(filePath, 'v3');

    expect(readFileSync(filePath, 'utf8')).toBe('v3');
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('v2');
  });

  it('works when no previous file exists (first write)', async () => {
    const filePath = join(TEST_DIR, 'state.yaml');
    await atomicWriteState(filePath, 'first');

    expect(readFileSync(filePath, 'utf8')).toBe('first');
    expect(existsSync(`${filePath}.bak`)).toBe(false);
  });
});
