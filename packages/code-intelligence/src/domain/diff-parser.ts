import type { DiffHunk } from '@ai-orchestrator/schemas';

const DIFF_HEADER_RE = /^diff --git a\/.+ b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseDiffToHunks(diff: string): DiffHunk[] {
  if (!diff.trim()) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  const lines = diff.split('\n');
  let currentFile = '';
  let hunkStart = 0;
  let hunkLength = 0;
  let hunkLines: string[] = [];

  function flushHunk(): void {
    if (currentFile && hunkLines.length > 0) {
      hunks.push({
        filePath: currentFile,
        startLine: hunkStart,
        endLine: hunkStart + hunkLength - 1,
        content: hunkLines.join('\n'),
      });
    }
    hunkLines = [];
  }

  for (const line of lines) {
    const fileMatch = DIFF_HEADER_RE.exec(line);
    if (fileMatch?.[1]) {
      flushHunk();
      currentFile = fileMatch[1];
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch?.[1]) {
      flushHunk();
      hunkStart = parseInt(hunkMatch[1], 10);
      hunkLength = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      continue;
    }

    if (
      currentFile &&
      hunkStart > 0 &&
      !line.startsWith('---') &&
      !line.startsWith('+++') &&
      !line.startsWith('index ')
    ) {
      hunkLines.push(line);
    }
  }

  flushHunk();
  return hunks;
}
