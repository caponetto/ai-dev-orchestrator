import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runHook(stagedFile: string, failTypecheck = false) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-pre-commit-test-'));
  directories.push(directory);
  const commandLog = join(directory, 'commands.log');
  writeFileSync(commandLog, '');
  const git = join(directory, 'git');
  writeFileSync(
    git,
    '#!/bin/sh\nif [ "$1" = diff ]; then printf "%s\\n" "$STAGED_FILE"; else printf "head\\n"; fi\n',
  );
  const pnpm = join(directory, 'pnpm');
  writeFileSync(
    pnpm,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\nif [ "$1" = typecheck ] && [ "$FAIL_TYPECHECK" = 1 ]; then exit 1; fi\n',
  );
  chmodSync(git, 0o755);
  chmodSync(pnpm, 0o755);

  let succeeded = true;
  try {
    execFileSync('/bin/sh', [resolve('.husky/pre-commit')], {
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env['PATH'] ?? ''}`,
        COMMAND_LOG: commandLog,
        STAGED_FILE: stagedFile,
        FAIL_TYPECHECK: failTypecheck ? '1' : '0',
      },
      stdio: 'pipe',
    });
  } catch {
    succeeded = false;
  }
  return { succeeded, commands: readFileSync(commandLog, 'utf8').trim().split('\n') };
}

describe('pre-commit dependency declarations', () => {
  it.each(['packages/cli/src/composition-root.ts', 'packages/config-templates/src/static/role.md'])(
    'refreshes declarations before typed lint for %s',
    (stagedFile) => {
      const result = runHook(stagedFile);
      expect(result.succeeded).toBe(true);
      expect(result.commands.slice(0, 3)).toEqual([
        'typecheck',
        'exec lint-staged',
        'format:check',
      ]);
      expect(result.commands.filter((command) => command === 'typecheck')).toHaveLength(2);
      expect(result.commands).toContain('lint');
    },
  );

  it('keeps documentation-only commits independent of workspace builds', () => {
    expect(runHook('docs/getting-started.md')).toEqual({
      succeeded: true,
      commands: ['exec lint-staged', 'format:check'],
    });
  });

  it('stops before lint-staged when dependency declarations cannot be built', () => {
    expect(runHook('packages/cli/src/composition-root.ts', true)).toEqual({
      succeeded: false,
      commands: ['typecheck'],
    });
  });
});
