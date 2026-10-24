import { noopLogger } from '@ai-dev-orchestrator/ports';
import { ShutdownCoordinator } from '@ai-dev-orchestrator/recovery';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installShutdownDeadline } from '../install-shutdown-deadline';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('CLI shutdown deadline', () => {
  it.each([true, false].flatMap((fail) => [true, false].map((json) => ({ fail, json }))))(
    'preserves interruption status and output format (throw=$fail, JSON=$json)',
    ({ fail, json }) => {
      const previousArgv = process.argv;
      process.argv = [
        ...previousArgv.filter((arg) => arg !== '--json'),
        ...(json ? ['--json'] : []),
      ];
      vi.useFakeTimers();
      const coordinator = new ShutdownCoordinator({} as never, {} as never, 50);
      const error = vi.fn(() => {
        if (fail) {
          throw new Error('diagnostic failure');
        }
      });
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('test exit');
      });
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      try {
        installShutdownDeadline(coordinator, { ...noopLogger, error });
        coordinator.requestShutdown('signal');
        vi.advanceTimersByTime(50);
        expect(exit).toHaveBeenCalledExactlyOnceWith(4);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('last durable progress'));
        if (fail) {
          expect(stderr).not.toHaveBeenCalled();
        } else {
          const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
          if (json) {
            const parsed: unknown = JSON.parse(output);
            expect(parsed).toHaveProperty('error.code', 4);
            expect(output).toContain('Graceful shutdown timed out');
          } else {
            expect(output).toContain('Remediation:');
          }
        }
      } finally {
        coordinator.uninstall();
        process.argv = previousArgv;
      }
    },
  );
});
