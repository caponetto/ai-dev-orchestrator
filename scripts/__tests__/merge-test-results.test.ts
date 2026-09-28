import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collect,
  extractSuites,
  indent,
  main,
  numberAttr,
  openingTagEnd,
  prefixAttr,
  prefixPath,
  reportPaths,
  selectedKinds,
  withSuiteDir,
} from '../merge-test-results.js';

function suite(name: string, extra = ''): string {
  return `<testsuite name="${name}" tests="1" failures="0" errors="0" skipped="0" time="0.5"${extra}><testcase name="t" classname="${name}" time="0.5"/></testsuite>`;
}

function sink(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }),
    text: () => chunks.join(''),
  };
}

describe('numberAttr', () => {
  const tag = '<testsuite name="s" tests="7" failures="1.5" skipped="">';

  it('parses numeric attributes', () => {
    expect(numberAttr(tag, 'tests')).toBe(7);
    expect(numberAttr(tag, 'failures')).toBe(1.5);
  });

  it('returns 0 for missing, empty, and non-numeric attributes', () => {
    expect(numberAttr(tag, 'errors')).toBe(0);
    expect(numberAttr(tag, 'skipped')).toBe(0);
    expect(numberAttr(tag, 'time')).toBe(0);
  });
});

describe('openingTagEnd', () => {
  it('finds the closing angle bracket', () => {
    expect(openingTagEnd('<testsuite name="s">')).toBe(19);
  });

  it('returns -1 when there is no bracket', () => {
    expect(openingTagEnd('<testsuite')).toBe(-1);
  });
});

describe('prefixPath', () => {
  const prefix = 'packages/utils/';

  it('prepends the package prefix', () => {
    expect(prefixPath('src/a.ts', prefix)).toBe('packages/utils/src/a.ts');
  });

  it('normalises backslashes and a leading ./', () => {
    expect(prefixPath('src\\nested\\a.ts', prefix)).toBe('packages/utils/src/nested/a.ts');
    expect(prefixPath('./src/a.ts', prefix)).toBe('packages/utils/src/a.ts');
  });

  it('is a no-op when the value is empty or already prefixed', () => {
    expect(prefixPath('', prefix)).toBe('');
    expect(prefixPath('packages/utils/src/a.ts', prefix)).toBe('packages/utils/src/a.ts');
  });
});

describe('prefixAttr', () => {
  it('prefixes the attribute value in place', () => {
    expect(prefixAttr('<testsuite name="src/a.ts">', 'name', 'packages/utils/')).toBe(
      '<testsuite name="packages/utils/src/a.ts">',
    );
  });

  it('leaves the tag untouched when the attribute is absent', () => {
    expect(prefixAttr('<testsuite tests="1">', 'name', 'packages/utils/')).toBe(
      '<testsuite tests="1">',
    );
  });

  it('restores the suite dir before applying the package prefix', () => {
    expect(
      prefixAttr('<testsuite name="health.e2e.ts">', 'name', 'packages/dashboard/', 'e2e/'),
    ).toBe('<testsuite name="packages/dashboard/e2e/health.e2e.ts">');
  });
});

describe('withSuiteDir', () => {
  it('restores a bare basename to its suite dir', () => {
    expect(withSuiteDir('health.e2e.ts', 'e2e/')).toBe('e2e/health.e2e.ts');
  });

  it('leaves a value that already has a directory alone', () => {
    expect(withSuiteDir('e2e/health.e2e.ts', 'e2e/')).toBe('e2e/health.e2e.ts');
    expect(withSuiteDir('deep/nested/health.e2e.ts', 'e2e/')).toBe('deep/nested/health.e2e.ts');
  });

  it('is a no-op when no suite dir is supplied', () => {
    expect(withSuiteDir('src/a.ts', '')).toBe('src/a.ts');
  });

  it('normalizes windows separators', () => {
    expect(withSuiteDir('e2e\\health.e2e.ts', 'e2e/')).toBe('e2e/health.e2e.ts');
  });

  it('passes an empty value through', () => {
    expect(withSuiteDir('', 'e2e/')).toBe('');
  });
});

describe('extractSuites', () => {
  it('extracts a single suite', () => {
    expect(extractSuites(suite('src/a.ts'))).toEqual([suite('src/a.ts')]);
  });

  it('extracts several suites', () => {
    const xml = `<?xml version="1.0"?><testsuites>${suite('a.ts')}${suite('b.ts')}</testsuites>`;
    expect(extractSuites(xml)).toEqual([suite('a.ts'), suite('b.ts')]);
  });

  it('does not split on a self-closing testcase inside a suite', () => {
    const xml = `${suite('a.ts')}${suite('b.ts')}`;
    expect(extractSuites(xml)).toHaveLength(2);
  });

  it('handles a self-closing testsuite', () => {
    expect(extractSuites('<testsuite name="a.ts" tests="0" />')).toEqual([
      '<testsuite name="a.ts" tests="0" />',
    ]);
  });

  it('stops at an unterminated suite', () => {
    expect(extractSuites('<testsuite name="a.ts" tests="1">')).toEqual([]);
  });

  it('returns nothing when there are no suites', () => {
    expect(extractSuites('<testsuites></testsuites>')).toEqual([]);
  });
});

describe('indent', () => {
  it('indents every non-blank line', () => {
    expect(indent('a\n\nb', 1)).toBe('  a\n\n  b');
  });

  it('uses two spaces per depth level', () => {
    expect(indent('a', 2)).toBe('    a');
  });
});

describe('collect', () => {
  it('strips hostname and prefixes the suite name and classnames', () => {
    const xml = `<testsuite name="src/a.ts" hostname="runner-1" tests="1"><testcase name="t" classname="src/a.ts"/></testsuite>`;
    const [collected] = collect('packages/utils/', xml);
    expect(collected?.xml).not.toContain('hostname');
    expect(collected?.xml).toContain('name="packages/utils/src/a.ts"');
    expect(collected?.xml).toContain('classname="packages/utils/src/a.ts"');
  });

  it('keeps the original reported name for dedup decisions', () => {
    const [collected] = collect('packages/utils/', suite('test/integration/x.test.ts'));
    expect(collected?.reported).toBe('test/integration/x.test.ts');
  });

  it('reads the numeric counters', () => {
    const xml =
      '<testsuite name="a.ts" tests="4" failures="2" errors="1" skipped="3" time="1.25"/>';
    const [collected] = collect('packages/utils/', xml);
    expect(collected).toMatchObject({ tests: 4, failures: 2, errors: 1, skipped: 3, time: 1.25 });
  });
});

describe('selectedKinds', () => {
  it('defaults to every suite kind', () => {
    expect(selectedKinds([])).toEqual(['unit', 'integration', 'e2e', 'scripts']);
  });

  it('accepts a comma-separated subset in order', () => {
    expect(selectedKinds(['--suites=unit,integration'])).toEqual(['unit', 'integration']);
  });

  it('ignores surrounding whitespace and unrelated args', () => {
    expect(selectedKinds(['--foo', '--suites= e2e , unit '])).toEqual(['e2e', 'unit']);
  });

  it('rejects unknown suite kinds', () => {
    expect(() => selectedKinds(['--suites=unit,bogus'])).toThrow(/Invalid --suites value/u);
  });

  it('rejects an empty selection', () => {
    expect(() => selectedKinds(['--suites='])).toThrow(/Invalid --suites value/u);
    expect(() => selectedKinds(['--suites=,'])).toThrow(/Invalid --suites value/u);
  });
});

describe('reportPaths', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'report-paths-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the reports that exist, tagged with their kind', () => {
    writeFileSync(join(dir, 'test-report.unit.junit.xml'), '<testsuites/>', 'utf-8');
    mkdirSync(join(dir, 'test-results'), { recursive: true });
    writeFileSync(join(dir, 'test-results', 'junit.xml'), '<testsuites/>', 'utf-8');
    expect(reportPaths(dir, 'utils', ['unit', 'integration', 'e2e'])).toEqual([
      { prefix: 'packages/utils/', path: join(dir, 'test-report.unit.junit.xml'), kind: 'unit' },
      { prefix: 'packages/utils/', path: join(dir, 'test-results', 'junit.xml'), kind: 'e2e' },
    ]);
  });

  it('returns nothing when no report exists', () => {
    expect(reportPaths(dir, 'utils', ['unit'])).toEqual([]);
  });
});

describe('merge-test-results main', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'merge-results-'));
    mkdirSync(join(root, 'packages'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeReport(pkg: string, file: string, xml: string): void {
    const dir = join(root, 'packages', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), xml, 'utf-8');
  }

  function readMerged(): string {
    return readFileSync(join(root, 'test-results', 'junit.xml'), 'utf-8');
  }

  it('merges reports and sums the totals', () => {
    writeReport(
      'utils',
      'test-report.unit.junit.xml',
      `<testsuites>${suite('src/a.ts')}</testsuites>`,
    );
    writeReport(
      'core',
      'test-report.unit.junit.xml',
      `<testsuites>${suite('src/b.ts')}</testsuites>`,
    );
    const out = sink();
    main(root, ['--suites=unit'], out.stream);

    const merged = readMerged();
    expect(merged).toContain('tests="2"');
    expect(merged).toContain('name="packages/utils/src/a.ts"');
    expect(merged).toContain('name="packages/core/src/b.ts"');
    expect(out.text()).toContain('Merged 2 suite(s) from 2 report(s)');
  });

  it('drops integration suites that the unit report also contains', () => {
    writeReport(
      'core',
      'test-report.unit.junit.xml',
      `<testsuites>${suite('src/a.ts')}${suite('test/integration/b.test.ts')}</testsuites>`,
    );
    writeReport(
      'core',
      'test-report.integration.junit.xml',
      `<testsuites>${suite('test/integration/b.test.ts')}</testsuites>`,
    );
    const out = sink();
    main(root, ['--suites=unit,integration'], out.stream);

    const merged = readMerged();
    expect(merged.match(/<testsuite name="packages\/core\/src\/a\.ts"/gu)).toHaveLength(1);
    expect(
      merged.match(/<testsuite name="packages\/core\/test\/integration\/b\.test\.ts"/gu),
    ).toHaveLength(1);
    expect(merged).toContain('tests="2"');
    expect(out.text()).toContain('deduped:  1 suite(s)');
  });

  it('keeps integration suites when there is no unit report to overlap with', () => {
    writeReport(
      'dashboard-server',
      'test-report.integration.junit.xml',
      `<testsuites>${suite('test/integration/only.test.ts')}</testsuites>`,
    );
    const out = sink();
    main(root, ['--suites=integration'], out.stream);

    expect(readMerged()).toContain(
      'name="packages/dashboard-server/test/integration/only.test.ts"',
    );
    expect(out.text()).not.toContain('deduped');
  });

  it('restores the testDir Playwright drops from e2e suite names', () => {
    const dir = join(root, 'packages', 'dashboard', 'test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'junit.xml'),
      `<testsuites>${suite('health.e2e.ts')}</testsuites>`,
      'utf-8',
    );
    main(root, ['--suites=e2e'], sink().stream);

    const merged = readMerged();
    expect(merged).toContain('name="packages/dashboard/e2e/health.e2e.ts"');
    expect(merged).toContain('classname="packages/dashboard/e2e/health.e2e.ts"');
    expect(merged).not.toContain('name="packages/dashboard/health.e2e.ts"');
  });

  it('collects the root-level scripts report without a packages/ prefix', () => {
    writeFileSync(
      join(root, 'test-report.scripts.junit.xml'),
      `<testsuites>${suite('scripts/__tests__/merge-test-results.test.ts')}</testsuites>`,
      'utf-8',
    );
    const out = sink();
    main(root, ['--suites=scripts'], out.stream);

    const merged = readMerged();
    expect(merged).toContain('name="scripts/__tests__/merge-test-results.test.ts"');
    expect(merged).toContain('tests="1"');
    expect(out.text()).toContain('Merged 1 suite(s) from 1 report(s)');
  });

  it('excludes the scripts report when it is not requested', () => {
    writeFileSync(
      join(root, 'test-report.scripts.junit.xml'),
      `<testsuites>${suite('scripts/__tests__/merge-test-results.test.ts')}</testsuites>`,
      'utf-8',
    );
    writeReport(
      'utils',
      'test-report.unit.junit.xml',
      `<testsuites>${suite('src/a.ts')}</testsuites>`,
    );
    main(root, ['--suites=unit'], sink().stream);

    expect(readMerged()).not.toContain('scripts/__tests__');
  });

  it('writes a well-formed envelope with a trailing newline', () => {
    writeReport(
      'utils',
      'test-report.unit.junit.xml',
      `<testsuites>${suite('src/a.ts')}</testsuites>`,
    );
    main(root, ['--suites=unit'], sink().stream);

    const merged = readMerged();
    expect(merged.startsWith('<?xml version="1.0" encoding="UTF-8" ?>')).toBe(true);
    expect(merged).toContain('<testsuites name="ai-dev-orchestrator"');
    expect(merged.trimEnd().endsWith('</testsuites>')).toBe(true);
  });

  it('throws when the packages directory is missing', () => {
    rmSync(join(root, 'packages'), { recursive: true });
    expect(() => {
      main(root, [], sink().stream);
    }).toThrow(/Packages directory not found/u);
  });

  it('throws when no report matches the requested suites', () => {
    writeReport('utils', 'test-report.unit.junit.xml', `<testsuites>${suite('a.ts')}</testsuites>`);
    expect(() => {
      main(root, ['--suites=e2e'], sink().stream);
    }).toThrow(/No JUnit reports found for \[e2e\]/u);
  });
});
