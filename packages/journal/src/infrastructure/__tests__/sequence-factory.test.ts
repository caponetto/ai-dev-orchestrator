import { describe, expect, it } from 'vitest';

import { SequenceFactory } from '../sequence-factory';

describe('SequenceFactory', () => {
  it('starts at 1 by default', () => {
    const factory = new SequenceFactory();
    expect(factory.next()).toBe(1);
  });

  it('increments monotonically', () => {
    const factory = new SequenceFactory();
    expect(factory.next()).toBe(1);
    expect(factory.next()).toBe(2);
    expect(factory.next()).toBe(3);
  });

  it('starts at a custom value', () => {
    const factory = new SequenceFactory(10);
    expect(factory.next()).toBe(11);
  });

  it('peek returns current without advancing', () => {
    const factory = new SequenceFactory();
    factory.next();
    expect(factory.peek()).toBe(1);
    expect(factory.peek()).toBe(1);
  });

  it('reset sets the counter', () => {
    const factory = new SequenceFactory();
    factory.next();
    factory.next();
    factory.reset(100);
    expect(factory.next()).toBe(101);
  });
});
