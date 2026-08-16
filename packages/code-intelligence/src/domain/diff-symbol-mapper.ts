import type { DiffHunk, SymbolContext } from '@ai-orchestrator/schemas';

import type { ScipQueryEngine } from '../infrastructure/scip-query-engine';

export class DiffSymbolMapper {
  mapHunksToSymbols(
    hunks: readonly DiffHunk[],
    engine: Pick<ScipQueryEngine, 'symbolsInFile'>,
  ): SymbolContext[] {
    const seen = new Set<string>();
    const result: SymbolContext[] = [];

    for (const hunk of hunks) {
      const symbols = engine.symbolsInFile(hunk.filePath);

      for (const sym of symbols) {
        if (sym.line >= hunk.startLine && sym.line <= hunk.endLine && !seen.has(sym.symbol)) {
          seen.add(sym.symbol);
          result.push(sym);
        }
      }
    }

    return result;
  }
}
