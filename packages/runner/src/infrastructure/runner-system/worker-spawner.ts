class WorkerIdGenerator {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `worker-${String(this.counter).padStart(6, '0')}`;
  }

  reset(): void {
    this.counter = 0;
  }

  setCounter(value: number): void {
    this.counter = value;
  }
}

const defaultGenerator = new WorkerIdGenerator();

export function generateWorkerId(): string {
  return defaultGenerator.generate();
}

export function resetWorkerCounter(): void {
  defaultGenerator.reset();
}

export function setWorkerCounter(value: number): void {
  defaultGenerator.setCounter(value);
}
