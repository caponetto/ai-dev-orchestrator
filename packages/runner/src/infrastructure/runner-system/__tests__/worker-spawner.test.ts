import { describe, expect, it, beforeEach } from 'vitest';

import { generateWorkerId, resetWorkerCounter, setWorkerCounter } from '../worker-spawner';

describe('generateWorkerId', () => {
  beforeEach(() => {
    resetWorkerCounter();
  });

  it('generates sequential worker IDs', () => {
    expect(generateWorkerId()).toBe('worker-000001');
    expect(generateWorkerId()).toBe('worker-000002');
    expect(generateWorkerId()).toBe('worker-000003');
  });

  it('pads IDs to 6 digits', () => {
    const id = generateWorkerId();
    const number = id.replace('worker-', '');
    expect(number).toHaveLength(6);
  });

  it('increments monotonically across calls', () => {
    const ids = Array.from({ length: 10 }, () => generateWorkerId());
    const numbers = ids.map((id) => Number.parseInt(id.replace('worker-', ''), 10));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });
});

describe('resetWorkerCounter', () => {
  it('resets the counter so next ID starts from 1', () => {
    generateWorkerId();
    generateWorkerId();
    resetWorkerCounter();
    expect(generateWorkerId()).toBe('worker-000001');
  });
});

describe('setWorkerCounter', () => {
  beforeEach(() => {
    resetWorkerCounter();
  });

  it('resumes generation from the given value', () => {
    setWorkerCounter(5);
    expect(generateWorkerId()).toBe('worker-000006');
    expect(generateWorkerId()).toBe('worker-000007');
  });

  it('setting to 0 behaves like reset', () => {
    generateWorkerId();
    setWorkerCounter(0);
    expect(generateWorkerId()).toBe('worker-000001');
  });
});
