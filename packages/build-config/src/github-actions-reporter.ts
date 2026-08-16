import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SerializedError } from 'vitest';
import { GithubActionsReporter } from 'vitest/node';
import type { TestModule } from 'vitest/node';

const GENERIC_HEADER = '## Vitest Test Report';

interface CoverageMetric {
  total: number;
  covered: number;
  pct: number;
}

interface CoverageSummaryData {
  lines: CoverageMetric;
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
}

interface CoverageMapLike {
  getCoverageSummary(): { toJSON(): CoverageSummaryData };
}

function isCoverageMap(value: unknown): value is CoverageMapLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getCoverageSummary' in value &&
    typeof (value as Record<string, unknown>)['getCoverageSummary'] === 'function'
  );
}

function formatPct(pct: number): string {
  if (pct < 0) {
    return 'N/A';
  }
  return `${pct.toFixed(1)}%`;
}

export class NamedGithubActionsReporter extends GithubActionsReporter {
  private coverageData: unknown;

  onCoverage(coverage: unknown): void {
    this.coverageData = coverage;
  }

  override onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
  ): void {
    const realPath = this.options.jobSummary.outputPath;
    const name = this.ctx.config.name;

    if (!realPath || !this.options.jobSummary.enabled || !name) {
      super.onTestRunEnd(testModules, unhandledErrors);
      return;
    }

    const tempPath = join(tmpdir(), `vitest-summary-${String(process.pid)}.md`);
    writeFileSync(tempPath, '');

    this.options.jobSummary.outputPath = tempPath;
    try {
      super.onTestRunEnd(testModules, unhandledErrors);
    } finally {
      this.options.jobSummary.outputPath = realPath;
    }

    try {
      let content = readFileSync(tempPath, 'utf-8');
      content = content.replace(GENERIC_HEADER, `## ${name}`);

      if (isCoverageMap(this.coverageData)) {
        const s = this.coverageData.getCoverageSummary().toJSON();
        content += `- Coverage: Lines ${formatPct(s.lines.pct)} · Branches ${formatPct(s.branches.pct)} · Functions ${formatPct(s.functions.pct)} · Statements ${formatPct(s.statements.pct)}\n`;
      }

      appendFileSync(realPath, content);
    } catch {
      // temp file may be empty if summary was disabled
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // cleanup best-effort
      }
    }
  }
}
