import { describe, expect, it } from 'vitest';

import { SequenceGenerator } from '../sequence-generator';

describe('SequenceGenerator', () => {
  it('starts at 1', () => {
    const gen = new SequenceGenerator();
    expect(gen.next()).toBe(1);
  });

  it('increments monotonically', () => {
    const gen = new SequenceGenerator();
    expect(gen.next()).toBe(1);
    expect(gen.next()).toBe(2);
    expect(gen.next()).toBe(3);
  });

  it('peek returns current without advancing', () => {
    const gen = new SequenceGenerator();
    gen.next();
    gen.next();
    expect(gen.peek()).toBe(2);
    expect(gen.peek()).toBe(2);
  });

  it('reset returns to 0', () => {
    const gen = new SequenceGenerator();
    gen.next();
    gen.next();
    gen.reset();
    expect(gen.next()).toBe(1);
  });
});
