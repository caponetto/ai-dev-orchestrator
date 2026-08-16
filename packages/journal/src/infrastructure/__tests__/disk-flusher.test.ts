import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { flushToFile } from '../disk-flusher';

const TEST_DIR = join(tmpdir(), `disk-flusher-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('flushToFile', () => {
  it('creates file with header on first write', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    flushToFile(filePath, 'event1\n', '# Journal\n\n');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('# Journal\n\nevent1\n');
  });

  it('appends to existing file without repeating header', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    flushToFile(filePath, 'event1\n', '# Journal\n\n');
    flushToFile(filePath, 'event2\n', '# Journal\n\n');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('# Journal\n\nevent1\nevent2\n');
  });

  it('creates parent directories', () => {
    const filePath = join(TEST_DIR, 'nested', 'deep', 'journal.md');
    flushToFile(filePath, 'data\n');
    expect(existsSync(filePath)).toBe(true);
  });

  it('writes without header when none provided', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    flushToFile(filePath, 'event1\n');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('event1\n');
  });
});
