import type { CodeBundle, DiffHunk } from '@ai-orchestrator/schemas';

/** Port for SCIP-powered code intelligence that maps PR diffs to symbol-level context. */
export interface CodeIntelligence {
  /** Index a project's source code, producing a SCIP index for later querying. */
  indexProject(repoRoot: string): void;

  /** Map diff hunks to a focused code bundle of symbols and definitions within a token budget. */
  symbolsInDiff(hunks: readonly DiffHunk[]): CodeBundle;

  /** Parse a raw unified diff string and map it to a focused code bundle. */
  symbolsFromRawDiff(diff: string): CodeBundle;

  /** Check whether a project has an existing SCIP index. */
  isIndexed(repoRoot: string): boolean;
}
