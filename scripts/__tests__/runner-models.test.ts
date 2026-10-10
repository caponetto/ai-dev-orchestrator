import { describe, expect, it } from 'vitest';

import {
  findMissingModels,
  findNewModels,
  findUnlistedRoleModels,
  parseRoleModel,
  parseRunnerModels,
  renderRolesSummary,
  renderRunnerSummary,
} from '../runner-models/common.js';

describe('parseRunnerModels', () => {
  it('maps runner ids to their models', () => {
    const yaml = `runners:
  - id: a
    name: A
    models:
      - m1
      - m2
  - id: b
    name: B
    models:
      - org/m3
`;
    expect(parseRunnerModels(yaml)).toEqual(
      new Map([
        ['a', ['m1', 'm2']],
        ['b', ['org/m3']],
      ]),
    );
  });
});

describe('findMissingModels', () => {
  it('reports models absent from the listing', () => {
    expect(findMissingModels(['m1', 'm2'], 'm1 - Model One\n')).toEqual(['m2']);
  });

  it('does not match a model that is only a prefix of another', () => {
    expect(findMissingModels(['sonnet-5'], 'sonnet-5-thinking-high')).toEqual(['sonnet-5']);
  });

  it('ignores ANSI color codes and matches dotted ids', () => {
    expect(findMissingModels(['grok-4.6-low'], '\u001b[1mgrok-4.6-low\u001b[0m')).toEqual([]);
  });
});

describe('parseRoleModel', () => {
  it('reads top-level runner and model', () => {
    expect(parseRoleModel('r', 'id: r\nmodel: opencode/x\nrunner: opencode\n')).toEqual({
      role: 'r',
      runner: 'opencode',
      model: 'opencode/x',
    });
  });

  it('returns undefined when model is absent', () => {
    expect(parseRoleModel('r', 'id: r\nrunner: opencode\n')).toBeUndefined();
  });
});

describe('findUnlistedRoleModels', () => {
  const runners = new Map([['opencode', ['opencode/a']]]);

  it('accepts listed models', () => {
    expect(
      findUnlistedRoleModels([{ role: 'r', runner: 'opencode', model: 'opencode/a' }], runners),
    ).toEqual([]);
  });

  it('flags unlisted models and unknown runners', () => {
    const problems = findUnlistedRoleModels(
      [
        { role: 'r1', runner: 'opencode', model: 'opencode/b' },
        { role: 'r2', runner: 'nope', model: 'x' },
      ],
      runners,
    );
    expect(problems).toHaveLength(2);
  });
});

describe('findNewModels', () => {
  it('returns available ids that are not listed, deduplicated', () => {
    expect(findNewModels(['a'], 'a\nb\n b \n\nc\n')).toEqual(['b', 'c']);
  });

  it('skips ignored ids', () => {
    expect(findNewModels(['a'], 'a\nb\nc', [/b/])).toEqual(['c']);
  });

  it('matches ignore patterns against the whole id', () => {
    expect(findNewModels([], 'x-1\nx-1-pro\ny', [/x-\d/, /y.+/])).toEqual(['x-1-pro', 'y']);
  });

  it('returns nothing when every available model is listed', () => {
    expect(findNewModels(['a', 'b'], 'a\nb')).toEqual([]);
  });
});

describe('renderRunnerSummary', () => {
  it('shows version and current models with status', () => {
    const out = renderRunnerSummary({
      name: 'Codex',
      version: 'codex-cli 1.0',
      current: ['a', 'b'],
      removed: ['b'],
      added: [],
    });
    expect(out).toContain('## Codex');
    expect(out).toContain('`codex-cli 1.0`');
    expect(out).toContain('- ✅ `a`');
    expect(out).toContain('- ❌ `b`');
    expect(out).toContain('Removed models');
    expect(out).not.toContain('New models');
  });

  it('lists new models and omits the removed section when nothing was removed', () => {
    const out = renderRunnerSummary({
      name: 'X',
      version: '1',
      current: ['a'],
      removed: [],
      added: ['c'],
    });
    expect(out).toContain('New models available');
    expect(out).toContain('- `c`');
    expect(out).not.toContain('Removed models');
  });
});

describe('renderRolesSummary', () => {
  const runners = new Map([['opencode', ['opencode/a']]]);

  it('renders a sorted table with a status per role', () => {
    const out = renderRolesSummary(
      [
        { role: 'zeta', runner: 'opencode', model: 'opencode/b' },
        { role: 'alpha', runner: 'opencode', model: 'opencode/a' },
      ],
      runners,
    );
    expect(out).toContain('2 roles checked');
    expect(out).toContain('| `alpha` | opencode | `opencode/a` | ✅ listed |');
    expect(out).toContain('| `zeta` | opencode | `opencode/b` | ❌ not listed |');
    expect(out.indexOf('`alpha`')).toBeLessThan(out.indexOf('`zeta`'));
  });
});
