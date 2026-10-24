import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('CLI bundle cache inputs', () => {
  it('hashes command source and build configuration alongside embedded assets for both build modes', () => {
    const dryRun = JSON.parse(
      execFileSync(
        join(root, 'node_modules/.bin/turbo'),
        ['run', 'build:dev', 'build:prod', '--filter=@ai-dev-orchestrator/cli', '--dry=json'],
        { cwd: root, encoding: 'utf8' },
      ),
    ) as { tasks: { package: string; task: string; inputs: Record<string, string> }[] };
    const builds = dryRun.tasks.filter(
      (task) => task.package === '@ai-dev-orchestrator/cli' && task.task.startsWith('build:'),
    );
    expect(builds).toHaveLength(2);
    for (const build of builds) {
      expect(Object.keys(build.inputs), build.task).toEqual(
        expect.arrayContaining([
          'src/commands/approve.ts',
          'src/commands/answer.ts',
          'src/output/workflow-result.ts',
          'esbuild.config.js',
          'package.json',
          'tsconfig.json',
          '../config-templates/src/static/config.yaml',
        ]),
      );
    }
  });
});
