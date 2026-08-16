import type { CodeBundle, DiffHunk, SymbolContext } from '@ai-orchestrator/schemas';

import type { ScipQueryEngine } from '../infrastructure/scip-query-engine';

import { DiffSymbolMapper } from './diff-symbol-mapper';

const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export class CodeContextBuilder {
  private readonly mapper = new DiffSymbolMapper();

  build(
    hunks: readonly DiffHunk[],
    engine: Pick<ScipQueryEngine, 'symbolsInFile' | 'referencesTo' | 'definitionOf'>,
    tokenBudget: number,
  ): CodeBundle {
    const touchedSymbols = this.mapper.mapHunksToSymbols(hunks, engine);
    const symbols: SymbolContext[] = [];
    const relatedDefinitions: CodeBundle['relatedDefinitions'] = [];
    let tokenEstimate = 0;

    for (const sym of touchedSymbols) {
      const symTokens = estimateTokens(JSON.stringify(sym));
      if (tokenEstimate + symTokens > tokenBudget) {
        break;
      }
      symbols.push(sym);
      tokenEstimate += symTokens;

      const def = engine.definitionOf(sym.symbol);
      if (def && def.filePath !== sym.filePath) {
        const defEntry = {
          filePath: def.filePath,
          startLine: def.line,
          endLine: def.line + 10,
          content: '',
          symbol: def.symbol,
        };
        const defTokens = estimateTokens(JSON.stringify(defEntry));
        if (tokenEstimate + defTokens <= tokenBudget) {
          relatedDefinitions.push(defEntry);
          tokenEstimate += defTokens;
        }
      }
    }

    return { symbols, relatedDefinitions, tokenEstimate };
  }
}
