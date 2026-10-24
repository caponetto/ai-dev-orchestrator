import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createBaseTestConfig, workspaceAliases } from '../../packages/build-config/src/index';

describe('workspace process-owner subpath alias', () => {
  it('resolves the implementation before the package prefix', () => {
    const specifier = '@ai-dev-orchestrator/utils/owned-process';
    const match = Object.entries(workspaceAliases).find(
      ([name]) => specifier === name || specifier.startsWith(`${name}/`),
    );
    expect(match?.[0]).toBe(specifier);
    expect(match?.[1]).toMatch(/utils\/src\/owned-process\.ts$/u);
    expect(existsSync(match?.[1] ?? '')).toBe(true);
    expect(createBaseTestConfig({ useAliases: true }).resolve?.alias).toEqual(workspaceAliases);
  });
});
