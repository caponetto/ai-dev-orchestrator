import { ulid } from 'ulidx';

/** Injectable randomness source for test determinism (P-02). */
export interface RandomSource {
  /** Returns a random integer in [0, max). */
  randomInt(max: number): number;
}

/**
 * Generates ULID-based event IDs.
 *
 * @remarks
 * Format: `evt-` prefix + 26-char ULID (Crockford Base32).
 * Lexicographically sortable by time.
 * Injectable randomness for test determinism per Constitution P-02.
 */
export class UlidIdGenerator {
  private readonly prng: (() => number) | undefined;

  constructor(random?: RandomSource) {
    if (random) {
      this.prng = () => random.randomInt(256) / 256;
    }
  }

  /** Generate a new event ID prefixed with `evt-`. */
  generate(timestampMs: number): string {
    return `evt-${ulid(timestampMs, this.prng)}`;
  }
}
