import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLogger, noopLogger } from '../create-logger';

describe('createLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('emits all levels when minLevel is debug', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(debugSpy).toHaveBeenCalledWith('d');
    expect(infoSpy).toHaveBeenCalledWith('i');
    expect(warnSpy).toHaveBeenCalledWith('w');
    expect(errorSpy).toHaveBeenCalledWith('e');
  });

  it('suppresses debug when minLevel is info', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const logger = createLogger('info');
    logger.debug('d');
    logger.info('i');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('i');
  });

  it('suppresses debug and info when minLevel is warn', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const logger = createLogger('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('w');
  });

  it('only emits error when minLevel is error', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('error');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('e');
  });
});

describe('noopLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('never emits to console', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    noopLogger.debug('d');
    noopLogger.info('i');
    noopLogger.warn('w');
    noopLogger.error('e');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('file logging', () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    logDir = join(
      tmpdir(),
      `logger-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(logDir, { recursive: true });
    logFile = join(logDir, 'orchestrator.log');
  });

  afterEach(() => {
    if (existsSync(logDir)) {
      rmSync(logDir, { recursive: true });
    }
  });

  async function waitForFlush(): Promise<void> {
    await delay(50);
  }

  it('writes log messages to the file', async () => {
    const logger = createLogger('debug', logFile);
    logger.info('hello world');
    await waitForFlush();

    const content = readFileSync(logFile, 'utf-8');
    expect(content).toContain('[INFO ] hello world');
  });

  it('appends all severity levels that meet the threshold', async () => {
    const logger = createLogger('debug', logFile);
    logger.debug('d-msg');
    logger.info('i-msg');
    logger.warn('w-msg');
    logger.error('e-msg');
    await waitForFlush();

    const content = readFileSync(logFile, 'utf-8');
    expect(content).toContain('[DEBUG] d-msg');
    expect(content).toContain('[INFO ] i-msg');
    expect(content).toContain('[WARN ] w-msg');
    expect(content).toContain('[ERROR] e-msg');
  });

  it('respects minLevel threshold for file output', async () => {
    const logger = createLogger('warn', logFile);
    logger.debug('d-msg');
    logger.info('i-msg');
    logger.warn('w-msg');
    logger.error('e-msg');
    await waitForFlush();

    const content = readFileSync(logFile, 'utf-8');
    expect(content).not.toContain('d-msg');
    expect(content).not.toContain('i-msg');
    expect(content).toContain('[WARN ] w-msg');
    expect(content).toContain('[ERROR] e-msg');
  });

  it('formats lines with ISO timestamp', async () => {
    const logger = createLogger('info', logFile);
    logger.info('timestamped');
    await waitForFlush();

    const content = readFileSync(logFile, 'utf-8');
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z \[INFO ] timestamped\n$/);
  });

  it('does not write a file when logFilePath is omitted', async () => {
    const logger = createLogger('debug');
    logger.info('no file');
    await waitForFlush();

    expect(existsSync(logFile)).toBe(false);
  });

  it('silently ignores file write errors without crashing', () => {
    const badPath = join(logDir, 'nonexistent-dir', 'sub', 'deep', 'orchestrator.log');
    const logger = createLogger('debug', badPath);

    expect(() => {
      logger.info('this should not crash');
    }).not.toThrow();
  });
});
