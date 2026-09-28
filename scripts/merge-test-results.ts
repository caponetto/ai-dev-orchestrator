import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(import.meta.dirname, '..');

type SuiteKind = 'unit' | 'integration' | 'e2e' | 'scripts';

/** Vitest writes one file per suite kind; Playwright writes its own under `test-results/`. */
export const REPORTS: Record<SuiteKind, string[]> = {
  unit: ['test-report.unit.junit.xml'],
  integration: ['test-report.integration.junit.xml'],
  e2e: ['test-results', 'junit.xml'],
  scripts: ['test-report.scripts.junit.xml'],
};

/**
 * Kinds whose reports live at the repository root instead of inside a package, and so are collected
 * with an empty path prefix. `scripts/` runs from a root-level Vitest config, so its suite names are
 * already repository-relative.
 */
export const ROOT_KINDS: SuiteKind[] = ['scripts'];

export const SUITE_KINDS = Object.keys(REPORTS) as SuiteKind[];

/**
 * Must stay in sync with the `integrationOnly` include in `createBaseTestConfig()`. The unit config
 * of `core` and `workflow` also matches this directory, so their integration tests appear in both
 * reports and would otherwise be counted twice.
 */
const INTEGRATION_DIR = 'test/integration/';

/**
 * Playwright's `testDir`, which its junit reporter omits from suite names. Must stay in sync with
 * `testDir` in `packages/dashboard/playwright.config.ts`.
 */
const E2E_DIR = 'e2e/';

/** The directory each suite kind's reports are missing, if any. Vitest is already complete. */
const SUITE_DIRS: Partial<Record<SuiteKind, string>> = { e2e: E2E_DIR };

export interface Suite {
  xml: string;
  /** Testsuite name exactly as reported, relative to the package root. */
  reported: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
}

function stringAttr(openTag: string, attr: string): string {
  return new RegExp(`\\b${attr}="([^"]*)"`).exec(openTag)?.[1] ?? '';
}

export function numberAttr(openTag: string, attr: string): number {
  const raw = stringAttr(openTag, attr);
  if (raw === '') {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function openingTagEnd(block: string): number {
  return block.indexOf('>');
}

/**
 * Prepends the package directory to a report-relative path so it lines up with a repository path.
 *
 * Vitest already reports paths relative to each package's config root. Playwright does not, so its
 * reports go through `withSuiteDir()` first to restore the directory it drops.
 */
export function prefixPath(value: string, prefix: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized === '' || normalized.startsWith(prefix)) {
    return normalized;
  }
  return `${prefix}${normalized}`;
}

/**
 * Restores the directory Playwright drops from suite names.
 *
 * Playwright names a suite `relative(rootDir, file)`, and since v1.63 `rootDir` is the `testDir`
 * rather than the config directory, so `e2e/health.e2e.ts` arrives as the bare `health.e2e.ts`.
 * Codecov keys analytics off that name, so without the directory identically named specs in
 * different directories would collapse into one bucket. Values that already contain a separator are
 * left alone, which makes this a no-op if Playwright ever starts emitting config-relative names.
 */
export function withSuiteDir(value: string, suiteDir: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized === '' || normalized.includes('/')) {
    return normalized;
  }
  return `${suiteDir}${normalized}`;
}

export function prefixAttr(
  tag: string,
  attr: string,
  prefix: string,
  suiteDir: string = '',
): string {
  return tag.replace(
    new RegExp(`(\\b${attr}=")([^"]*)(")`, 'u'),
    (_match, head: string, value: string, tail: string) =>
      `${head}${prefixPath(withSuiteDir(value, suiteDir), prefix)}${tail}`,
  );
}

/**
 * Splits a report into its `<testsuite>` elements. Scans for the closing tag rather than using a
 * non-greedy regex, because a `<testcase ... />` inside a suite also ends in `/>`.
 */
export function extractSuites(xml: string): string[] {
  const suites: string[] = [];
  const openTag = /<testsuite\b/gu;
  for (let match = openTag.exec(xml); match !== null; match = openTag.exec(xml)) {
    const start = match.index;
    const tagEnd = openingTagEnd(xml.slice(start));
    if (tagEnd === -1) {
      break;
    }
    const selfClosing = xml[start + tagEnd - 1] === '/';
    if (selfClosing) {
      suites.push(xml.slice(start, start + tagEnd + 1));
      continue;
    }
    const close = xml.indexOf('</testsuite>', start + tagEnd);
    if (close === -1) {
      break;
    }
    suites.push(xml.slice(start, close + '</testsuite>'.length));
    openTag.lastIndex = close;
  }
  return suites;
}

export function indent(block: string, depth: number): string {
  const pad = '  '.repeat(depth);
  return block
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `${pad}${line.trim()}`))
    .join('\n');
}

export function collect(prefix: string, body: string, suiteDir: string = ''): Suite[] {
  return extractSuites(body).map((block) => {
    const tagEnd = openingTagEnd(block);
    const openTag = block.slice(0, tagEnd + 1);
    const rest = block.slice(tagEnd + 1);

    // `hostname` is not a stable Codecov key: Playwright sets it to the browser/project name
    // (e.g. "chromium") rather than the machine, so it is dropped for every producer.
    const cleanedOpenTag = prefixAttr(
      openTag.replace(/\s+hostname="[^"]*"/gu, ''),
      'name',
      prefix,
      suiteDir,
    );
    const cleanedRest = rest.replace(
      /(<testcase\b[^>]*?)\bclassname="([^"]*)"/gu,
      (_match, head: string, value: string) =>
        `${head}classname="${prefixPath(withSuiteDir(value, suiteDir), prefix)}"`,
    );

    return {
      xml: `${cleanedOpenTag}${cleanedRest}`,
      reported: stringAttr(openTag, 'name'),
      tests: numberAttr(openTag, 'tests'),
      failures: numberAttr(openTag, 'failures'),
      errors: numberAttr(openTag, 'errors'),
      skipped: numberAttr(openTag, 'skipped'),
      time: numberAttr(openTag, 'time'),
    };
  });
}

export function reportPaths(
  packageDir: string,
  packageName: string,
  kinds: SuiteKind[],
): { prefix: string; path: string; kind: SuiteKind }[] {
  const prefix = `packages/${packageName}/`;
  const found: { prefix: string; path: string; kind: SuiteKind }[] = [];
  for (const kind of kinds) {
    const path = resolve(packageDir, ...REPORTS[kind]);
    if (existsSync(path)) {
      found.push({ prefix, path, kind });
    }
  }
  return found;
}

/**
 * CI splits unit/integration and e2e across two jobs, each uploading its own report. Filtering
 * keeps suites from being counted twice when turbo restores cached `test:unit` outputs.
 */
export function selectedKinds(argv: string[]): SuiteKind[] {
  const flag = argv.find((arg) => arg.startsWith('--suites='));
  if (flag === undefined) {
    return SUITE_KINDS;
  }
  const requested = flag
    .slice('--suites='.length)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const unknown = requested.filter((value) => !SUITE_KINDS.includes(value as SuiteKind));
  if (requested.length === 0 || unknown.length > 0) {
    throw new Error(
      `Invalid --suites value. Expected a comma-separated subset of: ${SUITE_KINDS.join(', ')}`,
    );
  }
  return requested.filter((value): value is SuiteKind => SUITE_KINDS.includes(value as SuiteKind));
}

export function main(
  root: string = repoRoot,
  argv: string[] = process.argv.slice(2),
  out: NodeJS.WritableStream = process.stdout,
): void {
  const packagesDir = resolve(root, 'packages');
  const outputFile = resolve(root, 'test-results', 'junit.xml');
  if (!existsSync(packagesDir)) {
    throw new Error(`Packages directory not found at ${relative(root, packagesDir)}`);
  }

  const kinds = selectedKinds(argv);
  const suites: Suite[] = [];
  const sources: string[] = [];
  let duplicates = 0;

  const entries = readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageDir = resolve(packagesDir, entry.name);
    const reports = reportPaths(packageDir, entry.name, kinds);
    // `createBaseTestConfig()` partitions the two suites, so no test should appear in both reports.
    // If that partition is ever broken, keeping the integration copy would double-count the testcase
    // in Codecov, so drop the unit-side duplicate rather than let the inflation through.
    const hasIntegrationReport = reports.some((report) => report.kind === 'integration');

    for (const { prefix, path, kind } of reports) {
      const collected = collect(prefix, readFileSync(path, 'utf-8'), SUITE_DIRS[kind] ?? '');
      const kept =
        kind === 'unit' && hasIntegrationReport
          ? collected.filter((suite) => !suite.reported.startsWith(INTEGRATION_DIR))
          : collected;
      duplicates += collected.length - kept.length;
      suites.push(...kept);
      sources.push(relative(root, path));
    }
  }

  // `scripts/` has no package directory, so its report is collected from the root with an empty
  // prefix -- its suite names are already repository-relative.
  for (const kind of ROOT_KINDS) {
    if (!kinds.includes(kind)) {
      continue;
    }
    const path = resolve(root, ...REPORTS[kind]);
    if (!existsSync(path)) {
      continue;
    }
    suites.push(...collect('', readFileSync(path, 'utf-8')));
    sources.push(relative(root, path));
  }

  if (sources.length === 0) {
    throw new Error(
      `No JUnit reports found for [${kinds.join(', ')}]. Run the test suites with CI=true so the junit reporter is enabled.`,
    );
  }

  const sum = (pick: (suite: Suite) => number): number =>
    suites.reduce((total, suite) => total + pick(suite), 0);

  const totals = {
    tests: sum((suite) => suite.tests),
    failures: sum((suite) => suite.failures),
    errors: sum((suite) => suite.errors),
    skipped: sum((suite) => suite.skipped),
  };
  const time = sum((suite) => suite.time);

  const body = [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    `<testsuites name="ai-dev-orchestrator" tests="${String(totals.tests)}" failures="${String(totals.failures)}" errors="${String(totals.errors)}" skipped="${String(totals.skipped)}" time="${time.toFixed(6)}">`,
    ...suites.map((suite) => indent(suite.xml, 1)),
    '</testsuites>',
    '',
  ].join('\n');

  mkdirSync(resolve(root, 'test-results'), { recursive: true });
  writeFileSync(outputFile, body, 'utf-8');

  out.write(
    [
      `Merged ${String(suites.length)} suite(s) from ${String(sources.length)} report(s) into ${relative(root, outputFile)}`,
      `  suites:   ${kinds.join(', ')}`,
      ...(duplicates > 0
        ? [`  deduped:  ${String(duplicates)} suite(s) also present in the integration report`]
        : []),
      `  tests:    ${String(totals.tests)}`,
      `  failures: ${String(totals.failures)}`,
      `  errors:   ${String(totals.errors)}`,
      `  skipped:  ${String(totals.skipped)}`,
      `  time:     ${time.toFixed(2)}s`,
      '',
    ].join('\n'),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
