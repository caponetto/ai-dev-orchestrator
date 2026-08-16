/** Generates monotonically increasing sequence numbers for journal events. */
export class SequenceFactory {
  private current: number;

  constructor(startAt = 0) {
    this.current = startAt;
  }

  /** Return the next sequence number. */
  next(): number {
    this.current += 1;
    return this.current;
  }

  /** Return the current sequence number without advancing. */
  peek(): number {
    return this.current;
  }

  /** Reset the counter to a specific value (for restore from persisted state). */
  reset(value: number): void {
    this.current = value;
  }
}
