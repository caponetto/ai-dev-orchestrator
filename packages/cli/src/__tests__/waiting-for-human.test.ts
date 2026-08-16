import type { WorkflowEngine } from '@ai-orchestrator/ports';
import type { RunResult } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import type { OutputFormatter } from '../output/formatter';
import { handleWaitingForHuman } from '../waiting-for-human';

function makeFormatter(): OutputFormatter & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: vi.fn((msg: string) => {
      messages.push(`INFO: ${msg}`);
    }),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    summary: vi.fn(),
    startSpinner: vi.fn(),
    clearSpinner: vi.fn(),
    table: vi.fn(),
    json: vi.fn(),
  } as unknown as OutputFormatter & { messages: string[] };
}

const makeEngine = (waitingContext: unknown) =>
  ({
    getState: vi.fn().mockReturnValue({ waitingContext }),
  }) as unknown as WorkflowEngine;

const makeResult = (overrides?: Partial<RunResult>): RunResult => ({
  runId: 'run-test-001',
  finalState: 'WAITING_FOR_HUMAN',
  artifactInventory: [],
  manifest: {} as never,
  ...overrides,
});

describe('handleWaitingForHuman', () => {
  it('clears the spinner before printing any message', () => {
    const formatter = makeFormatter();
    const engine = makeEngine(undefined);

    handleWaitingForHuman(makeResult(), engine, 'run-1', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.clearSpinner).toHaveBeenCalledOnce();
  });

  it('prints budget exhaustion message with role suffix when role is present', () => {
    const formatter = makeFormatter();
    const engine = makeEngine({
      budgetExhaustion: { current: 50_000, limit: 100_000, role: 'architect' },
    });

    handleWaitingForHuman(makeResult(), engine, 'run-1', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Budget exhausted (50000 / 100000 tokens, role: architect). Use `ai approve run-1` to continue.',
    );
  });

  it('prints budget exhaustion message without role suffix when role is absent', () => {
    const formatter = makeFormatter();
    const engine = makeEngine({
      budgetExhaustion: { current: 80_000, limit: 200_000 },
    });

    handleWaitingForHuman(makeResult(), engine, 'run-2', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Budget exhausted (80000 / 200000 tokens). Use `ai approve run-2` to continue.',
    );
  });

  it('prints text-input prompt when requiredInput is "text"', () => {
    const formatter = makeFormatter();
    const engine = makeEngine({
      requiredInput: 'text',
      reason: 'Clarification needed on API design',
    });

    handleWaitingForHuman(makeResult(), engine, 'run-3', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Run paused: Clarification needed on API design. Use `ai answer run-3 "your answer"` to continue.',
    );
  });

  it('prints approval prompt when wc exists with non-text requiredInput', () => {
    const formatter = makeFormatter();
    const engine = makeEngine({
      requiredInput: 'approval',
      reason: 'Destructive action requires confirmation',
    });

    handleWaitingForHuman(makeResult(), engine, 'run-4', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Run paused: Destructive action requires confirmation. Use `ai approve run-4` to continue.',
    );
  });

  it('prints generic resume prompt when waitingContext is undefined', () => {
    const formatter = makeFormatter();
    const engine = makeEngine(undefined);

    handleWaitingForHuman(makeResult(), engine, 'run-5', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Run paused at WAITING_FOR_HUMAN. Use `ai resume run-5` to continue.',
    );
  });

  it('prints generic resume prompt when waitingContext is null', () => {
    const formatter = makeFormatter();
    const engine = makeEngine(null);

    handleWaitingForHuman(makeResult(), engine, 'run-6', formatter);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(formatter.info).toHaveBeenCalledOnce();
    expect(formatter.messages[0]).toBe(
      'INFO: Run paused at WAITING_FOR_HUMAN. Use `ai resume run-6` to continue.',
    );
  });

  it('uses the finalState from the result in the generic resume message', () => {
    const formatter = makeFormatter();
    const engine = makeEngine(undefined);
    const result = makeResult({ finalState: 'PAUSED' });

    handleWaitingForHuman(result, engine, 'run-7', formatter);

    expect(formatter.messages[0]).toBe(
      'INFO: Run paused at PAUSED. Use `ai resume run-7` to continue.',
    );
  });
});
