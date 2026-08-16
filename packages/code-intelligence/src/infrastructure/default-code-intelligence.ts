import type { CodeIntelligence } from '@ai-orchestrator/ports';
import type { CodeBundle, DiffHunk } from '@ai-orchestrator/schemas';

import { CodeContextBuilder } from '../domain/code-context-builder';
import { parseDiffToHunks } from '../domain/diff-parser';

import { ScipIndexer } from './scip-indexer';
import { ScipQueryEngine } from './scip-query-engine';

const DEFAULT_TOKEN_BUDGET = 50_000;

export interface DefaultCodeIntelligenceOptions {
  readonly tokenBudget?: number;
  readonly cacheDir?: string;
}

export class DefaultCodeIntelligence implements CodeIntelligence {
  private readonly indexer: ScipIndexer;
  private readonly engine = new ScipQueryEngine();
  private readonly builder = new CodeContextBuilder();
  private readonly tokenBudget: number;

  constructor(options?: DefaultCodeIntelligenceOptions) {
    this.indexer = new ScipIndexer({ cacheDir: options?.cacheDir });
    this.tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  }

  isIndexed(repoRoot: string): boolean {
    return this.indexer.isIndexed(repoRoot);
  }

  indexProject(repoRoot: string): void {
    if (this.engine.isLoaded()) {
      return;
    }

    if (this.indexer.isIndexed(repoRoot)) {
      this.engine.load(this.indexer.getCachePath(repoRoot));
      return;
    }

    const indexPath = this.indexer.index(repoRoot);
    this.engine.load(indexPath);
  }

  symbolsInDiff(hunks: readonly DiffHunk[]): CodeBundle {
    if (!this.engine.isLoaded()) {
      return { symbols: [], relatedDefinitions: [], tokenEstimate: 0 };
    }

    return this.builder.build(hunks, this.engine, this.tokenBudget);
  }

  symbolsFromRawDiff(diff: string): CodeBundle {
    if (!this.engine.isLoaded()) {
      return { symbols: [], relatedDefinitions: [], tokenEstimate: 0 };
    }

    const hunks = parseDiffToHunks(diff);
    return this.builder.build(hunks, this.engine, this.tokenBudget);
  }
}
