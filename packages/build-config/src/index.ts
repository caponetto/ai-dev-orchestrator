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

type TestReporters = NonNullable<NonNullable<ViteUserConfig['test']>['reporters']>;

/**
 * Emitted only on CI so that local runs and pre-commit stay unchanged. Turbo hashes `CI` via
 * `globalEnv`, so switching it on is a cache miss rather than a stale-output replay.
 */
export function shouldEmitJunit(): boolean {
  return process.env['CI'] === 'true';
}

export function createBaseTestConfig(opts?: {
  useAliases?: boolean;
  /**
   * For packages that keep unit tests under `test/unit/`. Those files are not matched by
   * `integrationOnly`, so without this they would run under neither task.
   */
  includeTestUnitDir?: boolean;
  integrationOnly?: boolean;
  name?: string;
}): ViteUserConfig {
  // `test:unit` and `test:integration` must partition the test tree. A file matched by both
  // costs a redundant execution and double-counts testcases in the merged JUnit report.
  const include: string[] =
    opts?.integrationOnly === true
      ? ['test/integration/**/*.test.ts']
      : opts?.includeTestUnitDir === true
        ? ['src/**/*.test.ts', 'test/unit/**/*.test.ts']
        : ['src/**/*.test.ts'];

  const reporters: TestReporters =
    process.env['GITHUB_ACTIONS'] === 'true'
      ? ['default', 'junit', 'blob', new NamedGithubActionsReporter()]
      : shouldEmitJunit()
        ? ['default', 'junit', 'blob']
        : ['default'];

  // `vitest --merge-reports` reads one flat directory of blob files, so every blob needs a name that
  // is unique across packages. Integration configs pass `name: '<pkg>:integration'`, so the part
  // before the colon is the package id.
  const projectId = (opts?.name ?? detectPackageName() ?? 'package').split(':')[0];

  return {
    resolve: opts?.useAliases ? { alias: workspaceAliases } : undefined,
    test: {
      name: opts?.name ?? detectPackageName(),
      reporters,
      include,
      outputFile: shouldEmitJunit()
        ? {
            junit: opts?.integrationOnly
              ? 'test-report.integration.junit.xml'
              : 'test-report.unit.junit.xml',
            // Per-package directory so Turbo can cache each task's output without two packages
            // writing the same path; `coverage:merge` flattens them into one directory to merge.
            blob: `.vitest-reports/${projectId}-${opts?.integrationOnly === true ? 'integration' : 'unit'}.json`,
          }
        : undefined,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        // Per-package lcov is for local inspection only; `coverage:merge` builds the Codecov report
        // from the blob reporters. Integration runs get their own directory so the two tasks can
        // both write a report under Turbo's parallel execution without clobbering each other.
        reportsDirectory: opts?.integrationOnly === true ? 'coverage-integration' : 'coverage',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
        // An integration run only touches part of `src/`, so its standalone percentage is low by
        // construction. Gating on it would fail every run; the unit run owns the threshold.
        thresholds:
          opts?.integrationOnly === true
            ? undefined
            : {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
              },
      },
    },
  };
}
