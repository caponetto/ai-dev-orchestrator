import type { DiffHunk, SymbolContext } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { DiffSymbolMapper } from '../diff-symbol-mapper';

function makeEngine(symbols: Record<string, SymbolContext[]>) {
  return {
    symbolsInFile: vi.fn((path: string) => symbols[path] ?? []),
  };
}

describe('DiffSymbolMapper', () => {
  it('returns symbols that overlap with diff hunks', () => {
    const engine = makeEngine({
      'src/foo.ts': [
        { symbol: 'pkg/Foo#bar.', filePath: 'src/foo.ts', line: 5, role: 'definition' },
        { symbol: 'pkg/Foo#baz.', filePath: 'src/foo.ts', line: 50, role: 'definition' },
      ],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 10, content: '...' },
    ];

    const mapper = new DiffSymbolMapper();
    const result = mapper.mapHunksToSymbols(hunks, engine);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('pkg/Foo#bar.');
  });

  it('deduplicates symbols across hunks', () => {
    const engine = makeEngine({
      'src/foo.ts': [
        { symbol: 'pkg/Foo#bar.', filePath: 'src/foo.ts', line: 5, role: 'definition' },
      ],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 7, content: '...' },
      { filePath: 'src/foo.ts', startLine: 4, endLine: 8, content: '...' },
    ];

    const mapper = new DiffSymbolMapper();
    const result = mapper.mapHunksToSymbols(hunks, engine);

    expect(result).toHaveLength(1);
  });

  it('returns empty array when no symbols match', () => {
    const engine = makeEngine({
      'src/foo.ts': [
        { symbol: 'pkg/Foo#bar.', filePath: 'src/foo.ts', line: 100, role: 'definition' },
      ],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 1, endLine: 10, content: '...' },
    ];

    const mapper = new DiffSymbolMapper();
    const result = mapper.mapHunksToSymbols(hunks, engine);

    expect(result).toEqual([]);
  });

  it('handles hunks from multiple files', () => {
    const engine = makeEngine({
      'src/a.ts': [{ symbol: 'pkg/A#', filePath: 'src/a.ts', line: 5, role: 'definition' }],
      'src/b.ts': [{ symbol: 'pkg/B#', filePath: 'src/b.ts', line: 3, role: 'definition' }],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/a.ts', startLine: 1, endLine: 10, content: '...' },
      { filePath: 'src/b.ts', startLine: 1, endLine: 10, content: '...' },
    ];

    const mapper = new DiffSymbolMapper();
    const result = mapper.mapHunksToSymbols(hunks, engine);

    expect(result).toHaveLength(2);
  });
});
