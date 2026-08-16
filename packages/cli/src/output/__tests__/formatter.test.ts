import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { OutputFormatter } from '../formatter';

describe('OutputFormatter', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('json mode', () => {
    it('prints data as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.print({ key: 'value' });
      expect(stdoutChunks[0]).toBe('{"key":"value"}\n');
    });

    it('prints success as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.success('done');
      expect(stdoutChunks[0]).toContain('"status":"success"');
    });

    it('prints error as JSON to stderr', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.error({ code: 1, message: 'fail', remediation: 'fix it' });
      expect(stderrChunks[0]).toContain('"error"');
    });

    it('prints summary as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.summary({ runId: 'r1', state: 'DONE' });
      expect(stdoutChunks[0]).toContain('"runId":"r1"');
    });

    it('prints state transition as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.stateTransition('INTAKE', 'PLANNING');
      expect(stdoutChunks[0]).toContain('"event":"transition"');
      expect(stdoutChunks[0]).toContain('"from":"INTAKE"');
    });

    it('suppresses progress in json mode', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.progress('loading...');
      expect(stdoutChunks).toHaveLength(0);
    });

    it('suppresses info in json mode', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.info('some info');
      expect(stdoutChunks).toHaveLength(0);
    });

    it('prints warning as JSON to stderr', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.warn('provider skipped');
      const parsed = JSON.parse(stderrChunks[0] ?? '') as { warning: string };
      expect(parsed.warning).toBe('provider skipped');
    });

    it('prints worker dispatch as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.workerDispatch('architect', 'PLANNING');
      const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
        event: string;
        role: string;
        state: string;
      };
      expect(parsed.event).toBe('worker_dispatch');
      expect(parsed.role).toBe('architect');
      expect(parsed.state).toBe('PLANNING');
    });

    it('prints worker complete as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.workerComplete('architect', true);
      const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
        event: string;
        role: string;
        success: boolean;
      };
      expect(parsed.event).toBe('worker_complete');
      expect(parsed.role).toBe('architect');
      expect(parsed.success).toBe(true);
    });

    it('suppresses startSpinner in json mode', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.startSpinner('working...');
      expect(stdoutChunks).toHaveLength(0);
    });
  });

  describe('text mode', () => {
    it('prints key-value pairs', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.print({ name: 'test', count: 42 });
      const output = stdoutChunks.join('');
      expect(output).toContain('name:');
      expect(output).toContain('test');
      expect(output).toContain('count:');
      expect(output).toContain('42');
    });

    it('prints success message', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.success('Workflow completed');
      expect(stdoutChunks.join('')).toContain('Workflow completed');
    });

    it('prints error to stderr with remediation', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.error({
        code: 2,
        message: 'Config invalid',
        remediation: 'Check your config',
      });
      const output = stderrChunks.join('');
      expect(output).toContain('Config invalid');
      expect(output).toContain('Check your config');
    });

    it('prints info message', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.info('Starting run');
      expect(stdoutChunks.join('')).toContain('Starting run');
    });

    it('prints warning to stderr', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.warn('provider skipped');
      expect(stderrChunks.join('')).toContain('provider skipped');
    });

    it('prints summary with header', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.summary({ 'Run ID': 'r1', 'Final State': 'DONE' });
      const output = stdoutChunks.join('');
      expect(output).toContain('Run Summary');
      expect(output).toContain('Run ID:');
      expect(output).toContain('r1');
    });

    it('prints state transitions', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.stateTransition('INTAKE', 'PLANNING');
      const output = stdoutChunks.join('');
      expect(output).toContain('INTAKE');
      expect(output).toContain('PLANNING');
    });

    it('prints worker dispatch in verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true, verbose: true });
      formatter.workerDispatch('architect', 'PLANNING');
      expect(stdoutChunks.join('')).toContain('architect');
    });

    it('suppresses worker dispatch in non-verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.workerDispatch('architect', 'PLANNING');
      expect(stdoutChunks).toHaveLength(0);
    });

    it('prints worker completion in verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true, verbose: true });
      formatter.workerComplete('architect', true);
      expect(stdoutChunks.join('')).toContain('architect');
      expect(stdoutChunks.join('')).toContain('completed');
    });

    it('prints worker failure in verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true, verbose: true });
      formatter.workerComplete('architect', false);
      expect(stdoutChunks.join('')).toContain('failed');
    });

    it('shows error detail in verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true, verbose: true });
      formatter.error({
        code: 1,
        message: 'fail',
        remediation: 'fix',
        detail: 'stack trace here',
      });
      expect(stderrChunks.join('')).toContain('stack trace here');
    });

    it('hides error detail in non-verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.error({
        code: 1,
        message: 'fail',
        remediation: 'fix',
        detail: 'stack trace here',
      });
      expect(stderrChunks.join('')).not.toContain('stack trace here');
    });

    it('prints progress message in non-TTY text mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.progress('loading data...');
      const output = stdoutChunks.join('');
      expect(output).toContain('loading data...');
      expect(output).toContain('\n');
    });

    it('suppresses workerComplete in non-verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.workerComplete('architect', true);
      expect(stdoutChunks).toHaveLength(0);
    });

    it('shows object error detail as JSON string in verbose mode', () => {
      const formatter = new OutputFormatter({ noColor: true, verbose: true });
      formatter.error({
        code: 1,
        message: 'fail',
        remediation: 'fix',
        detail: { cause: 'timeout', code: 504 },
      });
      const output = stderrChunks.join('');
      expect(output).toContain('timeout');
      expect(output).toContain('504');
    });
  });

  describe('section', () => {
    it('renders section header in text mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.section('Iterations');
      const output = stdoutChunks.join('');
      expect(output).toContain('── Iterations ──');
    });

    it('suppresses section in json mode', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.section('Iterations');
      expect(stdoutChunks).toHaveLength(0);
    });
  });

  describe('keyValue', () => {
    it('renders key-value pairs in text mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.keyValue({ status: 'running', transitions: 4 });
      const output = stdoutChunks.join('');
      expect(output).toContain('status:');
      expect(output).toContain('running');
      expect(output).toContain('transitions:');
      expect(output).toContain('4');
    });

    it('renders key-value pairs as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.keyValue({ status: 'running', transitions: 4 });
      const parsed = JSON.parse(stdoutChunks[0] ?? '') as { status: string; transitions: number };
      expect(parsed.status).toBe('running');
      expect(parsed.transitions).toBe(4);
    });
  });

  describe('table', () => {
    it('renders table with aligned columns in text mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.table(
        ['Name', 'Status'],
        [
          ['run-1', 'done'],
          ['run-2', 'running'],
        ],
      );
      const output = stdoutChunks.join('');
      expect(output).toContain('Name');
      expect(output).toContain('Status');
      expect(output).toContain('run-1');
      expect(output).toContain('done');
      expect(output).toContain('run-2');
      expect(output).toContain('running');
    });

    it('renders table as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.table(['Name', 'Status'], [['run-1', 'done']]);
      const parsed = JSON.parse(stdoutChunks[0] ?? '') as { headers: string[]; rows: string[][] };
      expect(parsed.headers).toEqual(['Name', 'Status']);
      expect(parsed.rows).toEqual([['run-1', 'done']]);
    });

    it('handles empty rows', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.table(['Name'], []);
      const output = stdoutChunks.join('');
      expect(output).toContain('Name');
    });

    it('handles single column', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.table(['ID'], [['a'], ['b']]);
      const output = stdoutChunks.join('');
      expect(output).toContain('a');
      expect(output).toContain('b');
    });

    it('handles rows shorter than headers', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.table(['Name', 'Status', 'Extra'], [['run-1']]);
      const output = stdoutChunks.join('');
      expect(output).toContain('Name');
      expect(output).toContain('Status');
      expect(output).toContain('run-1');
    });
  });

  describe('early formatter (CLI error path)', () => {
    it('renders error as JSON when json flag is set', () => {
      const formatter = new OutputFormatter({ json: true, noColor: false });
      formatter.error({ code: 1, message: 'Unknown command', remediation: 'Run `ai --help`.' });
      const output = stderrChunks.join('');
      const parsed = JSON.parse(output) as { error: { message: string } };
      expect(parsed.error.message).toBe('Unknown command');
    });

    it('renders error without ANSI codes when noColor is set', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.error({ code: 1, message: 'Bad input', remediation: 'Fix it.' });
      const output = stderrChunks.join('');
      expect(output).not.toMatch(/\[/u);
      expect(output).toContain('Bad input');
    });

    it('renders error as formatted text by default', () => {
      const formatter = new OutputFormatter({});
      formatter.error({ code: 1, message: 'Something broke', remediation: 'Try again.' });
      const output = stderrChunks.join('');
      expect(output).toContain('Something broke');
    });
  });

  describe('progressBar', () => {
    it('renders progress in non-TTY text mode', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.progressBar('Loading', 2, 3);
      const output = stdoutChunks.join('');
      expect(output).toContain('Loading');
      expect(output).toContain('67%');
      expect(output).toContain('2/3');
    });

    it('renders progress at 0%', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.progressBar('Starting', 0, 10);
      const output = stdoutChunks.join('');
      expect(output).toContain('0%');
    });

    it('renders progress at 100%', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.progressBar('Done', 5, 5);
      const output = stdoutChunks.join('');
      expect(output).toContain('100%');
    });

    it('renders progress as JSON', () => {
      const formatter = new OutputFormatter({ json: true });
      formatter.progressBar('Loading', 1, 2);
      const parsed = JSON.parse(stdoutChunks[0] ?? '') as {
        label: string;
        current: number;
        total: number;
        percent: number;
      };
      expect(parsed.label).toBe('Loading');
      expect(parsed.current).toBe(1);
      expect(parsed.total).toBe(2);
      expect(parsed.percent).toBe(50);
    });

    it('handles zero total gracefully', () => {
      const formatter = new OutputFormatter({ noColor: true });
      formatter.progressBar('Empty', 0, 0);
      const output = stdoutChunks.join('');
      expect(output).toContain('0%');
    });
  });

  describe('TTY mode', () => {
    const originalIsTTY = process.stdout.isTTY;
    const originalNoColor = process.env['NO_COLOR'];

    beforeEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      delete process.env['NO_COLOR'];
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
      if (originalNoColor !== undefined) {
        process.env['NO_COLOR'] = originalNoColor;
      } else {
        delete process.env['NO_COLOR'];
      }
    });

    it('applies ANSI color codes when color is enabled', () => {
      const formatter = new OutputFormatter({});
      formatter.info('colored output');
      const output = stdoutChunks.join('');
      expect(output).toContain('\x1b[34m');
      expect(output).toContain('\x1b[0m');
      expect(output).toContain('colored output');
    });

    it('progress writes carriage return in TTY mode', () => {
      const formatter = new OutputFormatter({});
      formatter.progress('loading...');
      const output = stdoutChunks.join('');
      expect(output).toContain('\r');
      expect(output).toContain('loading...');
    });

    it('progressBar writes inline update in TTY mode', () => {
      const formatter = new OutputFormatter({});
      formatter.progressBar('Loading', 2, 4);
      const output = stdoutChunks.join('');
      expect(output).toContain('\r');
      expect(output).toContain('50%');
      expect(output).toContain('Loading');
    });

    it('startSpinner creates interval and clearSpinner cleans up', () => {
      vi.useFakeTimers();
      const formatter = new OutputFormatter({});
      formatter.startSpinner('working...');
      vi.advanceTimersByTime(160);
      expect(stdoutChunks.length).toBeGreaterThan(0);
      expect(stdoutChunks.join('')).toContain('working...');
      formatter.clearSpinner();
      const chunkCountAfterClear = stdoutChunks.length;
      vi.advanceTimersByTime(160);
      expect(stdoutChunks.length).toBe(chunkCountAfterClear);
      vi.useRealTimers();
    });
  });
});
