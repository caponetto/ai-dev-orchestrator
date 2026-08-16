/**
 * Produces monotonically increasing sequence numbers within a run.
 */
export class SequenceGenerator {
  private current = 0;

  /** Get the next sequence number. */
  next(): number {
    return ++this.current;
  }

  /** Get the current sequence number without advancing. */
  peek(): number {
    return this.current;
  }

  /** Reset the sequence counter (for testing or new runs). */
  reset(): void {
    this.current = 0;
  }
}
