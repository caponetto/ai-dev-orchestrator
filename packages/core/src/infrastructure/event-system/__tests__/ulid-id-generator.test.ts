import { describe, expect, it } from 'vitest';

import { UlidIdGenerator } from '../ulid-id-generator';

describe('UlidIdGenerator', () => {
  it('generates IDs with evt- prefix', () => {
    const gen = new UlidIdGenerator();
    const id = gen.generate(Date.now());
    expect(id).toMatch(/^evt-/);
  });

  it('generates IDs with 26 Crockford Base32 chars after prefix', () => {
    const gen = new UlidIdGenerator();
    const id = gen.generate(Date.now());
    const ulidPart = id.slice(4);
    expect(ulidPart).toHaveLength(26);
    expect(ulidPart).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes timestamp in first 10 chars (sortable)', () => {
    const gen = new UlidIdGenerator({ randomInt: () => 0 });
    const t1 = 1700000000000;
    const t2 = 1700000001000;
    const id1 = gen.generate(t1);
    const id2 = gen.generate(t2);
    expect(id1 < id2).toBe(true);
  });

  it('uses injectable randomness for determinism', () => {
    let counter = 0;
    const gen = new UlidIdGenerator({ randomInt: (max: number) => counter++ % max });
    const id1 = gen.generate(1700000000000);
    counter = 0;
    const id2 = gen.generate(1700000000000);
    expect(id1).toBe(id2);
  });

  it('generates unique IDs for same timestamp with default random', () => {
    const gen = new UlidIdGenerator();
    const now = Date.now();
    const id1 = gen.generate(now);
    const id2 = gen.generate(now);
    expect(id1).not.toBe(id2);
  });
});
