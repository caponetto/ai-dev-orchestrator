import { humanize } from '../../lib/humanize';

import type { ReviewReportView } from './shared';
import { METADATA_KEYS, omitKeys, renderMetadata, renderObject, toRaw } from './shared';

function extractLangFromPath(file: string | undefined | null): string {
  if (!file) {
    return '';
  }
  const clean = file.replace(/:\d+$/, '');
  const dot = clean.lastIndexOf('.');
  if (dot === -1) {
    return '';
  }
  return clean.slice(dot + 1).toLowerCase();
}

function severityIndicator(severity: string | undefined): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'major':
      return '🟠';
    case 'minor':
      return '🟡';
    default:
      return '⚪';
  }
}

function resolveReviewStatus(
  verdict: string | undefined,
  approved: boolean | undefined,
): string | undefined {
  if (verdict) {
    return verdict;
  }
  if (approved === true) {
    return 'approve';
  }
  if (approved === false) {
    return 'request_changes';
  }
  return undefined;
}

export function renderReviewReport(view: ReviewReportView): string {
  const raw = toRaw(view);
  const sections: string[] = [];

  const statusLabel = resolveReviewStatus(view.verdict, view.approved);
  const heading = statusLabel ? `# Review Report: ${statusLabel}` : '# Review Report';
  sections.push(heading);

  const meta = renderMetadata(raw);
  if (meta) {
    sections.push(meta);
  }

  if (view.summary) {
    sections.push(`> ${view.summary}`);
  }

  if (view.reviewSummary) {
    const stats = view.reviewSummary;
    const pairs = Object.entries(stats)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => {
        const formatted = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `**${humanize(k)}:** ${formatted}`;
      })
      .join(' · ');
    if (pairs) {
      sections.push(pairs);
    }
  }

  const findings = view.findings;
  if (findings?.length) {
    sections.push('## Findings');
    const items = findings.map((f) => {
      const indicator = severityIndicator(f.severity);
      const header = `${indicator} **${f.id ?? '—'}** · ${f.severity ?? '—'} · ${f.category ?? '—'}`;
      const parts: string[] = [header];
      parts.push(f.description ?? '—');
      if (f.file) {
        const loc = f.line == null ? f.file : `${f.file}:${String(f.line)}`;
        parts.push(`**File:** \`${loc}\``);
      }
      if (f.evidence) {
        const lang = extractLangFromPath(f.file ?? null);
        parts.push(`**Evidence:**\n\n\`\`\`${lang}\n${f.evidence}\n\`\`\``);
      }
      if (f.suggestion) {
        parts.push(`**Suggestion:** ${f.suggestion}`);
      }
      if (f.sources?.length) {
        parts.push(`_Sources:_ ${f.sources.join(', ')}`);
      }
      return parts.join('\n\n');
    });
    sections.push(items.join('\n\n---\n\n'));
  } else {
    sections.push('## Findings\n\n_No findings_');
  }

  const handled = new Set([
    'approved',
    'summary',
    'verdict',
    'findings',
    'reviewSummary',
    ...METADATA_KEYS,
  ]);
  const remaining = omitKeys(raw, handled);
  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}
