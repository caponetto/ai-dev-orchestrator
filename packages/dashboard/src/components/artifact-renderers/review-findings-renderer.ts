import type { ACEntry, JsonObject, ReviewFinding, UntrackedChangeEntry } from './shared';
import { METADATA_KEYS, omitKeys, renderObject } from './shared';

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

const REVIEW_FINDINGS_KNOWN_KEYS = [
  'title',
  'summary',
  'acceptanceCriteria',
  'untrackedChanges',
  'risks',
  'findings',
  'e2eTestSummary',
  ...METADATA_KEYS,
];

function renderFindingsHeader(view: JsonObject): string[] {
  const parts: string[] = [];

  const rawTitle = view['title'] as string | undefined;
  if (rawTitle) {
    const title = rawTitle.replace(/^Context:\s*/i, '');
    parts.push(`# ${title}`);
  }

  return parts;
}

function renderACSection(
  ac:
    | {
        addressed?: ACEntry[];
        partiallyAddressed?: ACEntry[];
        notAddressed?: ACEntry[];
      }
    | undefined,
): string[] {
  if (!ac) {
    return [];
  }
  const hasEntries =
    (ac.addressed?.length ?? 0) > 0 ||
    (ac.partiallyAddressed?.length ?? 0) > 0 ||
    (ac.notAddressed?.length ?? 0) > 0;
  if (!hasEntries) {
    return [];
  }

  const parts: string[] = ['### Acceptance Criteria'];

  if (ac.addressed?.length) {
    parts.push(
      ac.addressed
        .map((a) => {
          const line = `- ✅ ${a.criterion ?? '—'}`;
          return a.evidence ? `${line}\n  - _${a.evidence}_` : line;
        })
        .join('\n'),
    );
  }

  if (ac.partiallyAddressed?.length) {
    parts.push(
      ac.partiallyAddressed
        .map((a) => {
          const line = `- 🟡 ${a.criterion ?? '—'}`;
          return a.note ? `${line}\n  - _${a.note}_` : line;
        })
        .join('\n'),
    );
  }

  if (ac.notAddressed?.length) {
    parts.push(
      ac.notAddressed
        .map((a) => {
          const line = `- ❌ ${a.criterion ?? '—'}`;
          return a.note ? `${line}\n  - _${a.note}_` : line;
        })
        .join('\n'),
    );
  }

  return parts;
}

function renderE2eSummarySection(e2e: JsonObject): string {
  const lines: string[] = ['### E2E Test Results'];

  const passed = e2e['passed'] as boolean | undefined;
  const framework = (e2e['framework'] as string | undefined) ?? 'playwright';
  const testCount = e2e['testCount'] as number | undefined;
  const results = e2e['results'] as
    { passed?: number; failed?: number; skipped?: number } | undefined;
  const statusIcon = passed ? '✅' : '❌';

  let statusLine = `${statusIcon} **${passed ? 'PASSED' : 'FAILED'}** — ${framework}`;
  if (testCount != null && results) {
    statusLine += ` · ${String(results.passed ?? 0)}/${String(testCount)} passed`;
    if (results.failed) {
      statusLine += `, ${String(results.failed)} failed`;
    }
  }
  lines.push(statusLine);

  const summary = e2e['summary'] as string | undefined;
  if (summary) {
    lines.push('', summary);
  }

  const videos = e2e['videos'] as Array<{ path?: string; testName?: string }> | undefined;
  if (videos?.length) {
    lines.push('', '**Videos:**');
    for (const v of videos) {
      const name = v.testName ?? 'test';
      const path = v.path ?? '';
      lines.push(`- 🎥 \`${path}\` — ${name}`);
    }
  }

  const bugs = e2e['uiBugsFound'] as
    Array<{ description?: string; severity?: string; testName?: string }> | undefined;
  if (bugs?.length) {
    lines.push('', '**UI Bugs Found:**');
    for (const b of bugs) {
      const sev = b.severity ? `[${b.severity}] ` : '';
      lines.push(`- ${sev}${b.description ?? '—'} _(found in: ${b.testName ?? '—'})_`);
    }
  }

  const failures = e2e['failures'] as Array<{ test?: string; error?: string }> | undefined;
  if (failures?.length) {
    lines.push('', '**Failures:**');
    for (const f of failures) {
      lines.push(`- **${f.test ?? '—'}:** ${f.error ?? 'unknown error'}`);
    }
  }

  return lines.join('\n');
}

export function renderReviewFindings(view: JsonObject): string {
  const sections: string[] = [];

  sections.push(...renderFindingsHeader(view));

  const summary = view['summary'] as string | undefined;
  if (summary) {
    sections.push(summary);
  }

  const ac = view['acceptanceCriteria'] as
    | {
        addressed?: ACEntry[];
        partiallyAddressed?: ACEntry[];
        notAddressed?: ACEntry[];
      }
    | undefined;
  sections.push(...renderACSection(ac));

  const untracked = view['untrackedChanges'] as UntrackedChangeEntry[] | undefined;
  if (untracked?.length) {
    sections.push(
      '### Untracked Changes',
      untracked.map((u) => `- \`${u.file ?? '—'}\` — ${u.description ?? '—'}`).join('\n'),
    );
  }

  const risks = view['risks'] as string[] | undefined;
  if (risks?.length) {
    sections.push('### Risks', risks.map((r) => `- ⚠️ ${r}`).join('\n'));
  }

  sections.push('### Findings');

  const findings = view['findings'] as ReviewFinding[] | undefined;
  if (findings?.length) {
    const items = findings.map((f, i) => {
      const parts: string[] = [`${String(i + 1)}. ${f.description ?? '—'}`];
      if (f.file) {
        parts.push(`   **File:** \`${f.file}\``);
      }
      if (f.evidence) {
        const lang = extractLangFromPath(f.file);
        parts.push(`**Evidence:**\n\n\`\`\`${lang}\n${f.evidence}\n\`\`\``);
      }
      if (f.suggestion) {
        parts.push(`   **Suggestion:** ${f.suggestion}`);
      }
      return parts.join('\n\n');
    });
    sections.push(items.join('\n\n'));
  } else {
    sections.push('_No findings_');
  }

  const e2eSummary = view['e2eTestSummary'] as JsonObject | undefined;
  if (e2eSummary) {
    sections.push(renderE2eSummarySection(e2eSummary));
  }

  const remaining = omitKeys(view, REVIEW_FINDINGS_KNOWN_KEYS);
  if (Object.keys(remaining).length > 0) {
    sections.push(renderObject(remaining, 1));
  }

  return sections.join('\n\n');
}
