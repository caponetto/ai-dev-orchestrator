import type { DiffHunk } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { CodeContextBuilder } from '../code-context-builder';

function makeEngine(
  fileSymbols: Record<
    string,
    Array<{ symbol: string; line: number; role: 'definition' | 'reference' }>
  >,
) {
  return {
    symbolsInFile: vi.fn((path: string) =>
      (fileSymbols[path] ?? []).map((s) => ({
        ...s,
        filePath: path,
      })),
    ),
    referencesTo: vi.fn(() => []),
    definitionOf: vi.fn((symbol: string) => {
      for (const [path, syms] of Object.entries(fileSymbols)) {
        const def = syms.find((s) => s.symbol === symbol && s.role === 'definition');
        if (def) {
          return { ...def, filePath: path };
        }
      }
      return undefined;
    }),
  };
}

describe('CodeContextBuilder', () => {
  it('builds a code bundle from diff hunks', () => {
    const engine = makeEngine({
      'src/foo.ts': [{ symbol: 'pkg/Foo#bar.', line: 5, role: 'definition' }],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 10, content: 'function bar() {}' },
    ];

    const builder = new CodeContextBuilder();
    const bundle = builder.build(hunks, engine, 10_000);

    expect(bundle.symbols).toHaveLength(1);
    expect(bundle.symbols[0].symbol).toBe('pkg/Foo#bar.');
    expect(bundle.tokenEstimate).toBeGreaterThan(0);
    expect(bundle.tokenEstimate).toBeLessThanOrEqual(10_000);
  });

  it('respects token budget by truncating', () => {
    const engine = makeEngine({
      'src/foo.ts': Array.from({ length: 100 }, (_, i) => ({
        symbol: `pkg/Sym${String(i)}`,
        line: i,
        role: 'definition' as const,
      })),
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 0, endLine: 100, content: 'x'.repeat(1000) },
    ];

    const builder = new CodeContextBuilder();
    const bundle = builder.build(hunks, engine, 500);

    expect(bundle.tokenEstimate).toBeLessThanOrEqual(500);
  });

  it('includes related definitions from other files', () => {
    const engine = makeEngine({
      'src/foo.ts': [{ symbol: 'pkg/X#', line: 5, role: 'reference' }],
      'src/bar.ts': [{ symbol: 'pkg/X#', line: 10, role: 'definition' }],
    });

    const hunks: DiffHunk[] = [
      { filePath: 'src/foo.ts', startLine: 3, endLine: 10, content: '...' },
    ];

    const builder = new CodeContextBuilder();
    const bundle = builder.build(hunks, engine, 10_000);

    expect(bundle.symbols).toHaveLength(1);
    expect(bundle.relatedDefinitions).toHaveLength(1);
    expect(bundle.relatedDefinitions[0].filePath).toBe('src/bar.ts');
  });

  it('returns empty bundle when no symbols match', () => {
    const engine = makeEngine({});

    const hunks: DiffHunk[] = [
      { filePath: 'src/missing.ts', startLine: 1, endLine: 10, content: '...' },
    ];

    const builder = new CodeContextBuilder();
    const bundle = builder.build(hunks, engine, 10_000);

    expect(bundle.symbols).toEqual([]);
    expect(bundle.relatedDefinitions).toEqual([]);
    expect(bundle.tokenEstimate).toBe(0);
  });
});
