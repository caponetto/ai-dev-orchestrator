/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect Vitest mock methods without invoking them. */
import { createRunId } from '@ai-dev-orchestrator/ports';
import {
  createMockArtifactStore,
  createMockContractRegistry,
  createMockManifestProducer,
} from '@ai-dev-orchestrator/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { RunReporting } from '../run-reporting';
import type { RunReportingSnapshot } from '../run-reporting';

function fixture() {
  const store = createMockArtifactStore();
  const producer = createMockManifestProducer();
  const debug = vi.fn();
  const write = vi.fn();
  const reporting = new RunReporting(
    store,
    createMockContractRegistry(),
    producer,
    { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    { write },
  );
  const snapshot: RunReportingSnapshot = {
    runId: createRunId('report'),
    config: null,
    startedAt: 0,
    stateHistory: ['WORK'],
    stateTimestamps: [],
    workerMetricsByRole: {},
    governanceDecisionCount: 1,
    escalationCount: 0,
  };
  return { store, producer, debug, write, reporting, snapshot };
}

describe('run reporting', () => {
  it('observes the execution snapshot after asynchronous inventory collection', async () => {
    const f = fixture();
    const inventory = await f.store.inventory();
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.store.inventory).mockImplementationOnce(async () => {
      await pending;
      return inventory;
    });
    let snapshot = f.snapshot;
    const getSnapshot = vi.fn(() => snapshot);
    const completion = f.reporting.complete(getSnapshot);
    expect(getSnapshot).not.toHaveBeenCalled();
    snapshot = { ...snapshot, governanceDecisionCount: 9 };
    release();
    await completion;
    expect(f.producer.produce).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ governanceDecisions: 9 }) as unknown,
      }),
    );
  });

  it('keeps final manifest writer failures visible but treats interim failures as best effort', async () => {
    const f = fixture();
    f.write.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(f.reporting.complete(() => f.snapshot)).rejects.toThrow('disk full');
    await expect(f.reporting.writeInterim(() => f.snapshot)).resolves.toBeUndefined();
    expect(f.debug).toHaveBeenCalledWith(expect.stringContaining('Interim manifest write failed'));
  });

  it('publishes a running interim manifest without mutating the producer result', async () => {
    const f = fixture();
    await f.reporting.writeInterim(() => ({
      ...f.snapshot,
      config: {
        runId: 'report',
        runDir: '/run',
        repoRoot: '/repo',
        sources: [],
        governancePolicy: {},
        roleAssignments: {},
        workflowDefinition: {
          name: 'custom',
          version: '2',
          initialState: 'WORK',
          terminalStates: [],
          states: {},
        },
      },
    }));
    expect(f.write).toHaveBeenCalledWith(
      'report',
      expect.objectContaining({
        status: 'running',
        timing: expect.objectContaining({ completedAt: '' }) as unknown,
      }),
    );
    const produced = vi.mocked(f.producer.produce).mock.results.at(-1)?.value as unknown;
    expect(produced).toHaveProperty('timing.completedAt', expect.not.stringMatching(/^$/));
  });

  it('tolerates inventory failure and writes early manifests without collecting inventory', async () => {
    const f = fixture();
    const inventory = vi.mocked(f.store.inventory).mockRejectedValue(new Error('unreadable'));
    expect(await f.reporting.complete(() => f.snapshot)).toMatchObject({ artifactRefs: [] });
    expect(f.debug).toHaveBeenCalledWith(expect.stringContaining('Inventory collection failed'));
    inventory.mockClear();
    f.reporting.writeEarly(f.snapshot);
    expect(inventory).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenLastCalledWith(
      'report',
      expect.objectContaining({ finalState: 'DONE' }),
    );
  });

  it('skips interim work when no manifest writer is configured', async () => {
    const f = fixture();
    const reporting = new RunReporting(f.store, createMockContractRegistry(), f.producer, {
      debug: f.debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    const getSnapshot = vi.fn(() => f.snapshot);
    await reporting.writeInterim(getSnapshot);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(f.store.inventory).not.toHaveBeenCalled();
    expect(reporting.buildEarly(f.snapshot).finalState).toBe('DONE');
  });
});
