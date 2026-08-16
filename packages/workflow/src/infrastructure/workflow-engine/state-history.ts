/** Tracks the ordered list of visited states for the FSM. */
export class StateHistory {
  private readonly visited: string[] = [];

  constructor(initial?: readonly string[]) {
    if (initial) {
      this.visited.push(...initial);
    }
  }

  /** Record entry to a state. */
  record(stateId: string): void {
    this.visited.push(stateId);
  }

  /** Check whether a state has been visited. */
  hasVisited(stateId: string): boolean {
    return this.visited.includes(stateId);
  }

  /** Get the full history. */
  getHistory(): readonly string[] {
    return [...this.visited];
  }

  /** Get the number of times a state has been visited. */
  visitCount(stateId: string): number {
    return this.visited.filter((s) => s === stateId).length;
  }
}
