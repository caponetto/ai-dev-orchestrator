import { readFileSync } from 'node:fs';

import type { SymbolContext, SymbolRole } from '@ai-orchestrator/schemas';
import { fromBinary } from '@bufbuild/protobuf';
import {
  type Document,
  IndexSchema,
  SymbolRole as ScipSymbolRole,
  type SymbolInformation,
} from '@scip-code/scip';

function decodeRole(roleBits: number): SymbolRole {
  if (roleBits & ScipSymbolRole.Definition) {
    return 'definition';
  }
  if (roleBits & ScipSymbolRole.Import) {
    return 'import';
  }
  if (roleBits & ScipSymbolRole.WriteAccess) {
    return 'write';
  }
  return 'reference';
}

function occurrenceLine(occ: { range: readonly number[] }): number {
  return occ.range[0] ?? 0;
}

export interface ParsedIndex {
  readonly documents: readonly Document[];
  readonly externalSymbols: readonly SymbolInformation[];
}

export class ScipQueryEngine {
  private loaded = false;
  private fileIndex = new Map<string, Document>();
  private symbolIndex = new Map<string, SymbolContext[]>();
  private definitionIndex = new Map<string, SymbolContext>();
  private symbolInfoMap = new Map<string, SymbolInformation>();

  isLoaded(): boolean {
    return this.loaded;
  }

  load(indexPath: string): void {
    const raw = readFileSync(indexPath);
    const index = fromBinary(IndexSchema, raw);
    this.buildIndices(index);
  }

  loadFromParsed(index: ParsedIndex): void {
    this.buildIndices(index);
  }

  symbolsInFile(filePath: string): SymbolContext[] {
    const doc = this.fileIndex.get(filePath);
    if (!doc) {
      return [];
    }

    return doc.occurrences.map((occ) => ({
      symbol: occ.symbol,
      filePath,
      line: occurrenceLine(occ),
      role: decodeRole(occ.symbolRoles),
      documentation: this.symbolInfoMap.get(occ.symbol)?.documentation[0],
    }));
  }

  referencesTo(symbol: string): SymbolContext[] {
    return (this.symbolIndex.get(symbol) ?? []).filter((c) => c.role === 'reference');
  }

  definitionOf(symbol: string): SymbolContext | undefined {
    return this.definitionIndex.get(symbol);
  }

  private buildIndices(index: ParsedIndex): void {
    this.fileIndex.clear();
    this.symbolIndex.clear();
    this.definitionIndex.clear();
    this.symbolInfoMap.clear();

    for (const info of index.externalSymbols) {
      this.symbolInfoMap.set(info.symbol, info);
    }

    for (const doc of index.documents) {
      this.fileIndex.set(doc.relativePath, doc);

      for (const sym of doc.symbols) {
        this.symbolInfoMap.set(sym.symbol, sym);
      }

      for (const occ of doc.occurrences) {
        const ctx: SymbolContext = {
          symbol: occ.symbol,
          filePath: doc.relativePath,
          line: occurrenceLine(occ),
          role: decodeRole(occ.symbolRoles),
          documentation: this.symbolInfoMap.get(occ.symbol)?.documentation[0],
        };

        const list = this.symbolIndex.get(occ.symbol);
        if (list) {
          list.push(ctx);
        } else {
          this.symbolIndex.set(occ.symbol, [ctx]);
        }

        if (occ.symbolRoles & ScipSymbolRole.Definition) {
          this.definitionIndex.set(occ.symbol, ctx);
        }
      }
    }

    this.loaded = true;
  }
}
