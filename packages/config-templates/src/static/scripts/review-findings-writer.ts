/**
 * Standalone script that deterministically transforms a review report (+ optional
 * canonical specification) into a review_findings artifact.
 *
 * Usage:
 *   node --experimental-strip-types --experimental-detect-module \
 *     ~/.ai/scripts/review-findings-writer.ts \
 *     --review-report /path/to/review_report.json \
 *     [--spec /path/to/canonical_specification.json]
 *
 * Reads the JSON files, applies deterministic rules, writes the result to stdout.
 * Only uses node:* builtins — no external dependencies. Requires Node >= 22.6.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types (self-contained — no monorepo imports)
// ---------------------------------------------------------------------------

interface ReviewReportFinding {
  readonly id: string;
  readonly category: string;
  readonly severity: 'critical' | 'major' | 'minor';
  readonly description: string;
  readonly sources?: readonly string[];
  readonly file?: string | null;
  readonly line?: number | null;
  readonly suggestion?: string | null;
  readonly evidence?: string | null;
  readonly attribution?: 'introduced' | 'worsened' | 'propagated' | 'pre-existing';
}

interface ReviewReport {
  readonly version: number;
  readonly approved: boolean;
  readonly summary: string;
  readonly findings: readonly ReviewReportFinding[];
  readonly verdict: 'approve' | 'request_changes';
  readonly reviewSummary?: {
    readonly totalFindings?: number;
    readonly critical?: number;
    readonly major?: number;
    readonly minor?: number;
  };
  readonly createdAt: string;
}

interface CanonicalSpecification {
  readonly title?: string;
  readonly prMetadata?: {
    readonly number?: number;
    readonly repositoryUrl?: string;
  };
  readonly correlation?: {
    readonly addressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly evidence?: string;
    }>;
    readonly partiallyAddressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly note?: string;
    }>;
    readonly notAddressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly note?: string;
    }>;
    readonly untrackedChanges?: ReadonlyArray<{
      readonly file: string;
      readonly description: string;
    }>;
  };
  readonly risks?: readonly string[];
}

interface OutputFinding {
  readonly description: string;
  readonly file?: string;
  readonly actionability: 'actionable' | 'advisory';
  readonly suggestion?: string;
  readonly evidence?: string;
}

interface ReviewFindings {
  readonly version: 1;
  readonly title?: string;
  readonly prUrl?: string;
  readonly summary?: string;
  readonly acceptanceCriteria?: {
    readonly addressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly evidence?: string;
    }>;
    readonly partiallyAddressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly note?: string;
    }>;
    readonly notAddressed?: ReadonlyArray<{
      readonly criterion: string;
      readonly note?: string;
    }>;
  };
  readonly untrackedChanges?: ReadonlyArray<{
    readonly file: string;
    readonly description: string;
  }>;
  readonly risks?: readonly string[];
  readonly findings: readonly OutputFinding[];
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Strengths derivation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Finding filtering / mapping
// ---------------------------------------------------------------------------

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function inferFileFromDescription(description: string): string | undefined {
  const patterns = [/\b([\w/.-]+\/[\w.-]+\.[a-z]{1,4})\b/, /\b(src\/[\w/.-]+\.[a-z]{2,4})\b/];
  for (const pat of patterns) {
    const match = description.match(pat);
    if (match?.[1] && !match[1].startsWith('http')) {
      return match[1];
    }
  }
  return undefined;
}

function isBlockingAttribution(
  attribution: ReviewReportFinding['attribution'] | undefined,
): boolean {
  return attribution === undefined || attribution === 'introduced' || attribution === 'worsened';
}

function mapFindings(findings: readonly ReviewReportFinding[]): OutputFinding[] {
  const result: OutputFinding[] = [];

  for (const f of findings) {
    if (!isBlockingAttribution(f.attribution)) {
      continue;
    }
    let filePath: string | undefined;
    if (isNonEmpty(f.file) && f.line != null) {
      filePath = `${f.file}:${String(f.line)}`;
    } else if (isNonEmpty(f.file)) {
      filePath = f.file;
    } else {
      filePath = inferFileFromDescription(f.description);
    }

    const entry: OutputFinding = {
      description: f.description,
      actionability: filePath ? 'actionable' : 'advisory',
      ...(filePath ? { file: filePath } : {}),
      ...(isNonEmpty(f.suggestion) ? { suggestion: f.suggestion } : {}),
      ...(isNonEmpty(f.evidence) ? { evidence: f.evidence } : {}),
    };
    result.push(entry);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function normalizeFilePath(filePath: string): string {
  const colonIdx = filePath.lastIndexOf(':');
  if (colonIdx > 0) {
    const maybeLine = filePath.slice(colonIdx + 1);
    if (/^\d+$/.test(maybeLine)) {
      return filePath.slice(0, colonIdx);
    }
  }
  return filePath;
}

function evidenceOverlaps(a: string, b: string): boolean {
  const normalizeWs = (s: string) => s.replaceAll(/\s+/g, ' ').trim();
  const na = normalizeWs(a);
  const nb = normalizeWs(b);
  if (na.length === 0 || nb.length === 0) {
    return false;
  }
  return na.includes(nb) || nb.includes(na);
}

function mergeFindings(primary: OutputFinding, candidate: OutputFinding): OutputFinding {
  return {
    ...primary,
    description: `${primary.description}\n\nAdditionally: ${candidate.description}`,
  };
}

function shouldMerge(
  primaryFile: string,
  candidateFile: string,
  primaryEvidence: string | undefined,
  candidateEvidence: string | undefined,
): boolean {
  if (primaryFile !== candidateFile || primaryFile === 'unknown') {
    return false;
  }
  if (!primaryEvidence || !candidateEvidence) {
    return false;
  }
  return evidenceOverlaps(primaryEvidence, candidateEvidence);
}

function deduplicateFindings(findings: OutputFinding[]): OutputFinding[] {
  if (findings.length <= 1) {
    return findings;
  }

  const merged = new Set<number>();
  const result: OutputFinding[] = [];

  for (let i = 0; i < findings.length; i++) {
    if (merged.has(i)) {
      continue;
    }
    let primary = findings[i];
    const primaryFile = primary.file ? normalizeFilePath(primary.file) : undefined;

    for (let j = i + 1; j < findings.length; j++) {
      if (merged.has(j)) {
        continue;
      }
      const candidate = findings[j];
      const candidateFile = candidate.file ? normalizeFilePath(candidate.file) : undefined;

      if (
        primaryFile &&
        candidateFile &&
        shouldMerge(primaryFile, candidateFile, primary.evidence, candidate.evidence)
      ) {
        merged.add(j);
        primary = mergeFindings(primary, candidate);
      }
    }

    result.push(primary);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

export function transform(report: ReviewReport, spec?: CanonicalSpecification): ReviewFindings {
  const mapped = mapFindings(report.findings);
  const findings = deduplicateFindings(mapped);

  const result: Record<string, unknown> = {
    version: 1,
    findings,
    createdAt: new Date().toISOString(),
  };

  if (spec?.title) {
    result['title'] = spec.title.replace(/^Context:\s*/i, '');
  }

  if (spec?.prMetadata?.repositoryUrl && spec.prMetadata.number) {
    result['prUrl'] = `${spec.prMetadata.repositoryUrl}/pull/${String(spec.prMetadata.number)}`;
  }

  result['summary'] = report.summary;

  if (spec?.correlation) {
    const ac: Record<string, unknown> = {};
    if (spec.correlation.addressed && spec.correlation.addressed.length > 0) {
      ac['addressed'] = spec.correlation.addressed;
    }
    if (spec.correlation.partiallyAddressed && spec.correlation.partiallyAddressed.length > 0) {
      ac['partiallyAddressed'] = spec.correlation.partiallyAddressed;
    }
    if (spec.correlation.notAddressed && spec.correlation.notAddressed.length > 0) {
      ac['notAddressed'] = spec.correlation.notAddressed;
    }
    if (Object.keys(ac).length > 0) {
      result['acceptanceCriteria'] = ac;
    }

    if (spec.correlation.untrackedChanges && spec.correlation.untrackedChanges.length > 0) {
      result['untrackedChanges'] = spec.correlation.untrackedChanges;
    }
  }

  if (spec?.risks && spec.risks.length > 0) {
    result['risks'] = spec.risks;
  }

  return result as unknown as ReviewFindings;
}

// ---------------------------------------------------------------------------
// Artifact discovery
// ---------------------------------------------------------------------------

function findLatestArtifact(artifactsDir: string, type: string): string | null {
  const typeDir = join(artifactsDir, type);
  if (!existsSync(typeDir)) {
    return null;
  }
  const files = readdirSync(typeDir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.meta.yaml'))
    .sort();
  const latest = files.at(-1);
  return latest ? join(typeDir, latest) : null;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  reviewReportPath: string;
  specPath?: string;
} {
  let reviewReportPath: string | undefined;
  let specPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--review-report' && i + 1 < argv.length) {
      reviewReportPath = argv[++i];
    } else if (argv[i] === '--spec' && i + 1 < argv.length) {
      specPath = argv[++i];
    }
  }

  if (!reviewReportPath) {
    process.stderr.write('Usage: review-findings-writer --review-report <path> [--spec <path>]\n');
    process.exit(1);
  }

  return { reviewReportPath, specPath };
}

function mainFromArgs(): void {
  const { reviewReportPath, specPath } = parseArgs(process.argv);

  const report = JSON.parse(readFileSync(reviewReportPath, 'utf8')) as ReviewReport;
  const spec = specPath
    ? (JSON.parse(readFileSync(specPath, 'utf8')) as CanonicalSpecification)
    : undefined;

  const output = transform(report, spec);
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

function mainFromArtifacts(artifactsDir: string): void {
  const reportPath = findLatestArtifact(artifactsDir, 'review_report');
  if (!reportPath) {
    process.stderr.write(`No review_report artifact found in ${artifactsDir}\n`);
    process.exit(1);
  }

  const specPath = findLatestArtifact(artifactsDir, 'canonical_specification');

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ReviewReport;
  const spec = specPath
    ? (JSON.parse(readFileSync(specPath, 'utf8')) as CanonicalSpecification)
    : undefined;

  const output = transform(report, spec);
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('review-findings-writer.ts') ||
    process.argv[1].endsWith('review-findings-writer.js'));

if (isDirectExecution) {
  const artifactsDir = process.env.ORCHESTRATOR_ARTIFACTS_DIR;
  if (artifactsDir) {
    mainFromArtifacts(artifactsDir);
  } else {
    mainFromArgs();
  }
}
