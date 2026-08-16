#!/usr/bin/env -S node --experimental-strip-types --experimental-detect-module
/**
 * Uploads review findings as a rich Markdown GitHub Gist via `gh`.
 *
 * Reads the structured review_findings JSON artifact, renders it to Markdown,
 * then uploads that Markdown file.
 *
 * Expects:
 *   ORCHESTRATOR_ARTIFACTS_DIR — run artifacts directory
 *   ORCHESTRATOR_RUN_ID
 *   ORCHESTRATOR_SCRIPT_RESULT — optional path; write {"message":"..."} for chat display
 *
 * Requires: gh CLI authenticated, Node >= 22.6
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const isMainModule = process.argv[1]?.endsWith('upload-findings-gist.ts');

export interface Candidate {
  readonly path: string;
  readonly mtime: number;
}

interface Finding {
  readonly description?: string;
  readonly file?: string | null;
  readonly suggestion?: string | null;
  readonly evidence?: string | null;
  readonly severity?: string;
  readonly category?: string;
}

interface ACEntry {
  readonly criterion?: string;
  readonly evidence?: string;
  readonly note?: string;
}

export interface FindingsDoc {
  readonly title?: string;
  readonly prUrl?: string;
  readonly summary?: string;
  readonly findings?: readonly Finding[];
  readonly risks?: readonly string[];
  readonly untrackedChanges?: readonly { file?: string; description?: string }[];
  readonly acceptanceCriteria?: {
    readonly addressed?: readonly ACEntry[];
    readonly partiallyAddressed?: readonly ACEntry[];
    readonly notAddressed?: readonly ACEntry[];
  };
}

export function collectMarkdownOrJsonFiles(dir: string, out: Candidate[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) {
      continue;
    }
    if (entry.endsWith('.md') || entry.endsWith('.json')) {
      out.push({ path: full, mtime: st.mtimeMs });
    }
  }
}

export function findLatestFindings(root: string): string | null {
  const candidates: Candidate[] = [];
  const findingsDir = join(root, 'review_findings');
  if (existsSync(findingsDir)) {
    collectMarkdownOrJsonFiles(findingsDir, candidates);
  }
  if (candidates.length === 0) {
    const nested = join(root, 'artifacts', 'review_findings');
    if (existsSync(nested)) {
      collectMarkdownOrJsonFiles(nested, candidates);
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

export function langFromPath(file: string | undefined | null): string {
  if (!file) {
    return '';
  }
  const clean = file.replace(/:\d+$/, '');
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

export function renderFindingsMarkdown(doc: FindingsDoc): string {
  const sections: string[] = [];

  if (doc.title) {
    sections.push(`# ${doc.title.replace(/^Context:\s*/i, '')}`);
  }

  if (doc.prUrl) {
    sections.push(`**PR:** ${doc.prUrl}`);
  }

  if (doc.summary) {
    sections.push(doc.summary);
  }

  const ac = doc.acceptanceCriteria;
  if (ac) {
    const lines: string[] = ['### Acceptance Criteria'];
    for (const a of ac.addressed ?? []) {
      lines.push(`- ✅ ${a.criterion ?? '—'}`);
      if (a.evidence) {
        lines.push(`  - _${a.evidence}_`);
      }
    }
    for (const a of ac.partiallyAddressed ?? []) {
      lines.push(`- 🟡 ${a.criterion ?? '—'}`);
      if (a.note) {
        lines.push(`  - _${a.note}_`);
      }
    }
    for (const a of ac.notAddressed ?? []) {
      lines.push(`- ❌ ${a.criterion ?? '—'}`);
      if (a.note) {
        lines.push(`  - _${a.note}_`);
      }
    }
    if (lines.length > 1) {
      sections.push(lines.join('\n'));
    }
  }

  if (doc.untrackedChanges?.length) {
    sections.push(
      '### Untracked Changes',
      doc.untrackedChanges
        .map((u) => `- \`${u.file ?? '—'}\` — ${u.description ?? '—'}`)
        .join('\n'),
    );
  }

  if (doc.risks?.length) {
    sections.push('### Risks', doc.risks.map((r) => `- ⚠️ ${r}`).join('\n'));
  }

  sections.push('### Findings');
  if (doc.findings?.length) {
    const items = doc.findings.map((f, i) => {
      const parts: string[] = [`${String(i + 1)}. ${f.description ?? '—'}`];
      if (f.file) {
        parts.push(`   **File:** \`${f.file}\``);
      }
      if (f.evidence) {
        const lang = langFromPath(f.file);
        const indented = f.evidence.split('\n').join('\n   ');
        parts.push(`   **Evidence:**\n   \`\`\`${lang}\n   ${indented}\n   \`\`\``);
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

  return `${sections.join('\n\n')}\n`;
}

export function loadFindingsDoc(path: string): FindingsDoc {
  const raw = readFileSync(path, 'utf-8').trim();
  try {
    return JSON.parse(raw) as FindingsDoc;
  } catch {
    // Already markdown — return a thin wrapper so we still upload readable content.
    return { summary: raw };
  }
}

if (isMainModule) {
  const artifactsDir = process.env.ORCHESTRATOR_ARTIFACTS_DIR;
  const runId = process.env.ORCHESTRATOR_RUN_ID;

  if (!artifactsDir || !runId) {
    console.error('Missing required env: ORCHESTRATOR_ARTIFACTS_DIR, ORCHESTRATOR_RUN_ID');
    process.exit(1);
  }

  const findingsFile = findLatestFindings(artifactsDir);

  if (!findingsFile) {
    console.error(`No review findings artifact found in ${artifactsDir}`);
    process.exit(1);
  }

  const doc = loadFindingsDoc(findingsFile);
  const markdown = renderFindingsMarkdown(doc);

  const tmpDir = mkdtempSync(join(tmpdir(), 'upload-findings-gist-'));
  const mdPath = join(tmpDir, 'review-findings.md');

  try {
    writeFileSync(mdPath, markdown, 'utf-8');

    const desc = `PR Review Findings — run ${runId}`;
    const result = execFileSync('gh', ['gist', 'create', mdPath, '--desc', desc], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const gistUrl = result.trim();
    const message = `Findings published to: ${gistUrl}`;
    console.log(message);

    const scriptResultPath = process.env.ORCHESTRATOR_SCRIPT_RESULT;
    if (scriptResultPath) {
      writeFileSync(scriptResultPath, JSON.stringify({ message }), 'utf-8');
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
