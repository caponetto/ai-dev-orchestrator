import type { Finding } from '@ai-dev-orchestrator/schemas';

const ACTIVE_STATUSES = new Set<string>(['open', 'escalated']);

export interface FilteredFindingsResult {
  readonly openFindings: readonly Finding[];
  readonly summary: string;
}

export function filterFindings(findings: readonly Finding[]): FilteredFindingsResult {
  const openFindings = findings.filter((f) => ACTIVE_STATUSES.has(f.status));
  const resolvedCount = findings.length - openFindings.length;

  const summary =
    resolvedCount > 0 ? `${String(resolvedCount)} findings resolved in previous iterations` : '';

  return { openFindings, summary };
}
