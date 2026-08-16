import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ViteUserConfig } from 'vitest/config';

import { NamedGithubActionsReporter } from './github-actions-reporter.js';

export { NamedGithubActionsReporter } from './github-actions-reporter.js';

const packagesDir = resolve(import.meta.dirname, '../../');

export const workspaceAliases: Record<string, string> = Object.fromEntries(
  readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const pkgPath = resolve(packagesDir, d.name, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string };
        return [pkg.name, resolve(packagesDir, d.name, 'src', 'index.ts')];
      } catch {
        return null;
      }
    })
    .filter((entry): entry is [string, string] => entry !== null),
);

function detectPackageName(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
      name?: string;
    };
    if (pkg.name) {
      const scopeMatch = /^@[^/]+\/(.+)$/u.exec(pkg.name);
      return scopeMatch ? scopeMatch[1] : pkg.name;
    }
  } catch {
    // fall through to stack-based detection
  }
  const stack = new Error().stack ?? '';
  const match = /packages\/([^/]+)\/vitest/u.exec(stack);
  if (match) {
    return match[1];
  }
  return undefined;
}

export function createBaseTestConfig(opts?: {
  useAliases?: boolean;
  includeIntegration?: boolean;
  integrationOnly?: boolean;
  name?: string;
}): ViteUserConfig {
  let include: string[];
  if (opts?.integrationOnly) {
    include = ['test/integration/**/*.test.ts'];
  } else if (opts?.includeIntegration) {
    include = ['src/**/*.test.ts', 'test/**/*.test.ts'];
  } else {
    include = ['src/**/*.test.ts'];
  }

  const reporters: ('default' | NamedGithubActionsReporter)[] =
    process.env['GITHUB_ACTIONS'] === 'true'
      ? ['default', new NamedGithubActionsReporter()]
      : ['default'];

  return {
    resolve: opts?.useAliases ? { alias: workspaceAliases } : undefined,
    test: {
      name: opts?.name ?? detectPackageName(),
      reporters,
      include,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  };
}
