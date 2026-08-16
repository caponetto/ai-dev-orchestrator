import type { DiffHunk, SymbolContext } from '@ai-orchestrator/schemas';
import { SymbolRole as ScipSymbolRole } from '@scip-code/scip';
import { describe, expect, it, vi } from 'vitest';

import { DefaultCodeIntelligence } from '../default-code-intelligence';
import { ScipIndexer } from '../scip-indexer';
import { ScipQueryEngine } from '../scip-query-engine';

function makeLoadedInstance(): DefaultCodeIntelligence {
  const ci = new DefaultCodeIntelligence({ cacheDir: '/tmp/ci-test-cache' });

  const engine = (ci as unknown as { engine: ScipQueryEngine }).engine;
  engine.loadFromParsed({
    documents: [
      {
        relativePath: 'src/foo.ts',
        occurrences: [
          {
            symbol: 'pkg/Foo#bar.',
            range: [5, 0, 5, 10],
            symbolRoles: ScipSymbolRole.Definition,
          },
          {
            symbol: 'pkg/Foo#baz.',
            range: [15, 0, 15, 8],
            symbolRoles: ScipSymbolRole.Definition,
          },
        ],
        symbols: [
          {
            symbol: 'pkg/Foo#bar.',
            documentation: ['The bar method'],
            relationships: [],
          },
        ],
      },
    ],
    externalSymbols: [],
  });

  return ci;
}

describe('DefaultCodeIntelligence', () => {
  it('implements CodeIntelligence interface', () => {
    const ci = new DefaultCodeIntelligence();
    expect(ci.isIndexed('/fake')).toBe(false);
    expect(typeof ci.indexProject).toBe('function');
    expect(typeof ci.symbolsInDiff).toBe('function');
    expect(typeof ci.symbolsFromRawDiff).toBe('function');
  });

  it('returns empty bundle when not indexed', () => {
    const ci = new DefaultCodeIntelligence();
    const hunks: DiffHunk[] = [{ filePath: 'foo.ts', startLine: 1, endLine: 5, content: '...' }];
    const bundle = ci.symbolsInDiff(hunks);
    expect(bundle.symbols).toEqual([]);
    expect(bundle.relatedDefinitions).toEqual([]);
    expect(bundle.tokenEstimate).toBe(0);
  });

  it('returns empty bundle from symbolsFromRawDiff when not indexed', () => {
    const ci = new DefaultCodeIntelligence();
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      '+const y = 2;',
      ' export { x };',
    ].join('\n');
    const bundle = ci.symbolsFromRawDiff(diff);
    expect(bundle.symbols).toEqual([]);
    expect(bundle.relatedDefinitions).toEqual([]);
    expect(bundle.tokenEstimate).toBe(0);
  });

  it('returns symbols from symbolsInDiff when engine is loaded', () => {
    const ci = makeLoadedInstance();

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 10, content: '+const x = 1;' },
    ];
    const bundle = ci.symbolsInDiff(hunks);

    expect(bundle.symbols.length).toBeGreaterThan(0);
    const symbolNames = bundle.symbols.map((s: SymbolContext) => s.symbol);
    expect(symbolNames).toContain('pkg/Foo#bar.');
  });

  it('returns symbols from symbolsFromRawDiff when engine is loaded', () => {
    const ci = makeLoadedInstance();

    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -3,3 +3,4 @@',
      ' const x = 1;',
      '+const y = 2;',
      ' export { x };',
    ].join('\n');
    const bundle = ci.symbolsFromRawDiff(diff);

    expect(bundle.symbols.length).toBeGreaterThan(0);
    const symbolNames = bundle.symbols.map((s: SymbolContext) => s.symbol);
    expect(symbolNames).toContain('pkg/Foo#bar.');
    expect(bundle.tokenEstimate).toBeGreaterThan(0);
  });

  it('indexProject calls indexer and loads engine', () => {
    const ci = new DefaultCodeIntelligence({ cacheDir: '/tmp/ci-test-cache' });

    const indexSpy = vi
      .spyOn(ScipIndexer.prototype, 'index')
      .mockReturnValue('/tmp/fake-index.scip');
    const loadSpy = vi.spyOn(ScipQueryEngine.prototype, 'load').mockImplementation(() => {
      // no-op — avoid reading a real file
    });

    ci.indexProject('/my/repo');

    expect(indexSpy).toHaveBeenCalledWith('/my/repo');
    expect(loadSpy).toHaveBeenCalledWith('/tmp/fake-index.scip');

    indexSpy.mockRestore();
    loadSpy.mockRestore();
  });

  it('indexProject is idempotent when engine is already loaded', () => {
    const ci = makeLoadedInstance();

    const indexSpy = vi.spyOn(ScipIndexer.prototype, 'index');

    ci.indexProject('/my/repo');

    expect(indexSpy).not.toHaveBeenCalled();

    indexSpy.mockRestore();
  });

  it('indexProject loads from cache when index file exists but engine not loaded', () => {
    const ci = new DefaultCodeIntelligence({ cacheDir: '/tmp/ci-test-cache' });

    const isIndexedSpy = vi.spyOn(ScipIndexer.prototype, 'isIndexed').mockReturnValue(true);
    const getCachePathSpy = vi
      .spyOn(ScipIndexer.prototype, 'getCachePath')
      .mockReturnValue('/tmp/cached.scip');
    const loadSpy = vi.spyOn(ScipQueryEngine.prototype, 'load').mockImplementation(() => {
      // no-op
    });
    const indexSpy = vi.spyOn(ScipIndexer.prototype, 'index');

    ci.indexProject('/my/repo');

    expect(indexSpy).not.toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalledWith('/tmp/cached.scip');

    isIndexedSpy.mockRestore();
    getCachePathSpy.mockRestore();
    loadSpy.mockRestore();
    indexSpy.mockRestore();
  });

  it('respects token budget', () => {
    const ci = new DefaultCodeIntelligence({ tokenBudget: 1, cacheDir: '/tmp/ci-test-cache' });

    const engine = (ci as unknown as { engine: ScipQueryEngine }).engine;
    engine.loadFromParsed({
      documents: [
        {
          relativePath: 'src/foo.ts',
          occurrences: [
            {
              symbol: 'pkg/Foo#bar.',
              range: [5, 0, 5, 10],
              symbolRoles: ScipSymbolRole.Definition,
            },
          ],
          symbols: [],
        },
      ],
      externalSymbols: [],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 10, content: '+const x = 1;' },
    ];
    const bundle = ci.symbolsInDiff(hunks);

    expect(bundle.tokenEstimate).toBeLessThanOrEqual(1);
  });
});
