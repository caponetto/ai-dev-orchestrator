class WorkerIdGenerator {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `worker-${String(this.counter).padStart(6, '0')}`;
  }

  reset(): void {
    this.counter = 0;
  }
}

const defaultGenerator = new WorkerIdGenerator();

export function generateWorkerId(): string {
  return defaultGenerator.generate();
}

export function resetWorkerCounter(): void {
  defaultGenerator.reset();
}
