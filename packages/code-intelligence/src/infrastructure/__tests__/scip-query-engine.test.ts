import { describe, expect, it } from 'vitest';

import type { ParsedIndex } from '../scip-query-engine';
import { ScipQueryEngine } from '../scip-query-engine';

function makeIndex(
  documents: ParsedIndex['documents'],
  externalSymbols: ParsedIndex['externalSymbols'] = [],
): ParsedIndex {
  return { documents, externalSymbols };
}

describe('ScipQueryEngine', () => {
  it('returns empty results when no index is loaded', () => {
    const engine = new ScipQueryEngine();
    expect(engine.symbolsInFile('foo.ts')).toEqual([]);
    expect(engine.referencesTo('some/symbol')).toEqual([]);
    expect(engine.definitionOf('some/symbol')).toBeUndefined();
  });

  it('reports loaded state', () => {
    const engine = new ScipQueryEngine();
    expect(engine.isLoaded()).toBe(false);
  });

  it('indexes symbols from parsed documents', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [
            { range: [5, 0, 10], symbol: 'pkg/Foo#bar.', symbolRoles: 1 },
            { range: [20, 0, 5], symbol: 'pkg/Foo#baz.', symbolRoles: 0 },
          ],
          symbols: [],
        } as ParsedIndex['documents'][number],
      ]),
    );

    expect(engine.isLoaded()).toBe(true);

    const symbols = engine.symbolsInFile('src/foo.ts');
    expect(symbols).toHaveLength(2);
    expect(symbols[0].symbol).toBe('pkg/Foo#bar.');
    expect(symbols[0].role).toBe('definition');
    expect(symbols[0].line).toBe(5);
    expect(symbols[1].role).toBe('reference');
  });

  it('finds definitions', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [{ range: [10, 0, 5], symbol: 'pkg/X#', symbolRoles: 1 }],
          symbols: [],
        } as ParsedIndex['documents'][number],
      ]),
    );

    const def = engine.definitionOf('pkg/X#');
    expect(def).toBeDefined();
    expect(def.filePath).toBe('src/foo.ts');
    expect(def.line).toBe(10);
  });

  it('finds references', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [{ range: [5, 0, 5], symbol: 'pkg/Y#', symbolRoles: 1 }],
          symbols: [],
        } as ParsedIndex['documents'][number],
        {
          relativePath: 'src/bar.ts',
          occurrences: [{ range: [15, 0, 5], symbol: 'pkg/Y#', symbolRoles: 0 }],
          symbols: [],
        } as ParsedIndex['documents'][number],
      ]),
    );

    const refs = engine.referencesTo('pkg/Y#');
    expect(refs).toHaveLength(1);
    expect(refs[0].filePath).toBe('src/bar.ts');
  });

  it('resolves documentation from symbol info', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [{ range: [5, 0, 5], symbol: 'pkg/Z#', symbolRoles: 1 }],
          symbols: [{ symbol: 'pkg/Z#', documentation: ['A useful class'], kind: 0 }],
        } as ParsedIndex['documents'][number],
      ]),
    );

    const symbols = engine.symbolsInFile('src/foo.ts');
    expect(symbols[0].documentation).toBe('A useful class');
  });

  it('returns empty for unknown file', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(makeIndex([]));
    expect(engine.symbolsInFile('nonexistent.ts')).toEqual([]);
  });

  it('decodes Import symbol role', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [{ range: [1, 0, 10], symbol: 'pkg/Imp#', symbolRoles: 2 }],
          symbols: [],
        } as ParsedIndex['documents'][number],
      ]),
    );

    const symbols = engine.symbolsInFile('src/foo.ts');
    expect(symbols[0].role).toBe('import');
  });

  it('decodes WriteAccess symbol role', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex([
        {
          relativePath: 'src/foo.ts',
          occurrences: [{ range: [1, 0, 10], symbol: 'pkg/W#', symbolRoles: 4 }],
          symbols: [],
        } as ParsedIndex['documents'][number],
      ]),
    );

    const symbols = engine.symbolsInFile('src/foo.ts');
    expect(symbols[0].role).toBe('write');
  });

  it('resolves documentation from external symbols', () => {
    const engine = new ScipQueryEngine();
    engine.loadFromParsed(
      makeIndex(
        [
          {
            relativePath: 'src/foo.ts',
            occurrences: [{ range: [5, 0, 5], symbol: 'ext/Lib#func.', symbolRoles: 0 }],
            symbols: [],
          } as ParsedIndex['documents'][number],
        ],
        [
          {
            symbol: 'ext/Lib#func.',
            documentation: ['External library function'],
            relationships: [],
          } as ParsedIndex['externalSymbols'][number],
        ],
      ),
    );

    const symbols = engine.symbolsInFile('src/foo.ts');
    expect(symbols[0].documentation).toBe('External library function');
  });
});
