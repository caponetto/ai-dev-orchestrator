import type { IntermediateRequirements } from '@ai-orchestrator/schemas';
import { hashContent } from '@ai-orchestrator/utils';

/** Recognized source reference types. */
export type SourceType = 'github_pr' | 'github_issue' | 'plain_text';

/** Structured metadata parsed from a typed source reference. */
export interface ParsedSourceReference {
  readonly type: SourceType;
  readonly owner?: string;
  readonly repo?: string;
  readonly number?: number;
  readonly ref?: string;
  readonly raw: string;
}

const GITHUB_PR_PATTERN = /^github:([^/]+)\/([^#]+)#(\d+)(?:@(.+))?$/;
const GITHUB_ISSUE_PATTERN = /^github-issue:([^/]+)\/([^#]+)#(\d+)$/;

/**
 * Parse a raw source string into a structured reference.
 * Supports:
 * - `github:owner/repo#123` — GitHub PR reference (optional `@base-branch`)
 * - `github-issue:owner/repo#456` — GitHub issue reference
 * - Plain text (fallback)
 */
export function parseSourceReference(raw: string): ParsedSourceReference {
  const trimmed = raw.trim();

  const prMatch = GITHUB_PR_PATTERN.exec(trimmed);
  if (prMatch) {
    return {
      type: 'github_pr',
      owner: prMatch[1],
      repo: prMatch[2],
      number: Number(prMatch[3]),
      ref: prMatch[4],
      raw: trimmed,
    };
  }

  const issueMatch = GITHUB_ISSUE_PATTERN.exec(trimmed);
  if (issueMatch) {
    return {
      type: 'github_issue',
      owner: issueMatch[1],
      repo: issueMatch[2],
      number: Number(issueMatch[3]),
      raw: trimmed,
    };
  }

  return { type: 'plain_text', raw: trimmed };
}

/**
 * Convert raw CLI source strings into IntermediateRequirements.
 * Typed references (github:, github-issue:) are parsed into structured metadata.
 * Plain text is treated as raw content for the agent to interpret.
 */
export function resolveIntakeSources(sources: readonly string[]): IntermediateRequirements[] {
  return sources.map((raw) => {
    const parsed = parseSourceReference(raw);
    const checksum = hashContent(raw);

    if (parsed.type === 'github_pr') {
      return {
        title: `PR #${String(parsed.number)} in ${parsed.owner ?? ''}/${parsed.repo ?? ''}`,
        description: parsed.ref ? `Base branch: ${parsed.ref}` : undefined,
        rawFields: {
          sourceType: parsed.type,
          owner: parsed.owner,
          repo: parsed.repo,
          prNumber: parsed.number,
          baseBranch: parsed.ref,
        },
        sourceMetadata: {
          fetchedAt: new Date().toISOString(),
          checksum,
        },
      };
    }

    if (parsed.type === 'github_issue') {
      return {
        title: `Issue #${String(parsed.number)} in ${parsed.owner ?? ''}/${parsed.repo ?? ''}`,
        rawFields: {
          sourceType: parsed.type,
          owner: parsed.owner,
          repo: parsed.repo,
          issueNumber: parsed.number,
        },
        sourceMetadata: {
          fetchedAt: new Date().toISOString(),
          checksum,
        },
      };
    }

    const trimmed = raw.trim();
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const title = lines[0] ?? '';
    const description = lines.length > 1 ? trimmed : undefined;

    return {
      title,
      description,
      rawFields: { sourceType: 'plain_text' },
      sourceMetadata: {
        fetchedAt: new Date().toISOString(),
        checksum,
      },
    };
  });
}
