import type * as NodeFs from 'node:fs';
import { closeSync, existsSync, fsyncSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JournalWriteError } from '../../domain/errors';
import { flushToFile } from '../disk-flusher';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>();
  return {
    ...original,
    fsyncSync: vi.fn(original.fsyncSync),
    closeSync: vi.fn(original.closeSync),
  };
});

const TEST_DIR = join(tmpdir(), `disk-flusher-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  vi.mocked(fsyncSync).mockRestore();
  vi.mocked(closeSync).mockClear();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('flushToFile', () => {
  it('reports a durability failure and closes the file instead of claiming the event was saved', () => {
    const filePath = join(TEST_DIR, 'journal.md');
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw new Error('EIO: journal sync failed');
    });

    expect(() => {
      flushToFile(filePath, 'event1\n');
    }).toThrow(JournalWriteError);
    expect(closeSync).toHaveBeenCalledWith(vi.mocked(fsyncSync).mock.calls[0][0]);

    flushToFile(filePath, 'event2\n');
    expect(readFileSync(filePath, 'utf8')).toBe('event1\nevent2\n');
  });

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
