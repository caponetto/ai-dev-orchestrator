import { describe, expect, it } from 'vitest';

import {
  resolveBorderColor,
  resolveNodeBackground,
  resolveSubBackground,
} from '../workflow-graph-nodes';

describe('resolveSubBackground', () => {
  it('returns preview color when preview is true', () => {
    expect(resolveSubBackground(true, false, '#abc', 'main')).toBe('#1e293b');
  });

  it('returns typeColor when current is true', () => {
    expect(resolveSubBackground(false, true, '#abc', 'main')).toBe('#abc');
  });

  it('returns branch background when role is branch', () => {
    expect(resolveSubBackground(false, false, '#abc', 'branch')).toBe('#111827');
  });

  it('returns default background for non-branch non-current', () => {
    expect(resolveSubBackground(false, false, '#abc', 'main')).toBe('#1f2937');
  });

  it('prioritizes preview over current', () => {
    expect(resolveSubBackground(true, true, '#abc', 'main')).toBe('#1e293b');
  });

  it('prioritizes current over branch role', () => {
    expect(resolveSubBackground(false, true, '#abc', 'branch')).toBe('#abc');
  });
});

describe('resolveNodeBackground', () => {
  const base = {
    preview: false,
    current: false,
    typeColor: '#abc',
    isTerminal: false,
    isAborted: false,
    role: 'main',
  };

  it('returns preview color when preview is true', () => {
    expect(resolveNodeBackground({ ...base, preview: true })).toBe('#1e293b');
  });

  it('returns typeColor when current is true', () => {
    expect(resolveNodeBackground({ ...base, current: true })).toBe('#abc');
  });

  it('returns aborted terminal background', () => {
    expect(resolveNodeBackground({ ...base, isTerminal: true, isAborted: true })).toBe('#7f1d1d');
  });

  it('returns success terminal background', () => {
    expect(resolveNodeBackground({ ...base, isTerminal: true, isAborted: false })).toBe('#14532d');
  });

  it('returns branch background', () => {
    expect(resolveNodeBackground({ ...base, role: 'branch' })).toBe('#111827');
  });

  it('returns default background', () => {
    expect(resolveNodeBackground(base)).toBe('#1f2937');
  });

  it('prioritizes preview over terminal states', () => {
    expect(
      resolveNodeBackground({ ...base, preview: true, isTerminal: true, isAborted: true }),
    ).toBe('#1e293b');
  });

  it('prioritizes current over terminal states', () => {
    expect(resolveNodeBackground({ ...base, current: true, isTerminal: true })).toBe('#abc');
  });
});

describe('resolveBorderColor', () => {
  it('returns typeColor when preview is true', () => {
    expect(resolveBorderColor(true, false, false, '#abc')).toBe('#abc');
  });

  it('returns active border when current is true', () => {
    expect(resolveBorderColor(false, true, false, '#abc')).toBe('#93c5fd');
  });

  it('returns typeColor when visited is true', () => {
    expect(resolveBorderColor(false, false, true, '#abc')).toBe('#abc');
  });

  it('returns default border color', () => {
    expect(resolveBorderColor(false, false, false, '#abc')).toBe('#374151');
  });

  it('prioritizes preview over current', () => {
    expect(resolveBorderColor(true, true, false, '#abc')).toBe('#abc');
  });

  it('prioritizes current over visited', () => {
    expect(resolveBorderColor(false, true, true, '#abc')).toBe('#93c5fd');
  });
});
