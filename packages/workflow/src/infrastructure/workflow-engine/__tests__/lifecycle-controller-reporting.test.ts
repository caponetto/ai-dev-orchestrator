import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderReport } from '@ai-dev-orchestrator/run-manifest';
import {
  createMockArtifactStore,
  createMockContractRegistry,
  createMockGovernance,
  createMockJournalWriter,
  createMockManifestProducer,
  createMockRunnerSystem,
  createMockStatePersistence,
} from '@ai-dev-orchestrator/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LifecycleController } from '../lifecycle-controller';

describe('LifecycleController report output', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lifecycle-report-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function fixture(reportOutputPath: string) {
    const debug = vi.fn();
    const controller = new LifecycleController({
      runner: createMockRunnerSystem(),
      artifactStore: createMockArtifactStore(),
      governanceEngine: createMockGovernance(),
      contractRegistry: createMockContractRegistry(),
      journalWriter: createMockJournalWriter(),
      statePersistence: createMockStatePersistence(),
      manifestProducer: createMockManifestProducer(),
      logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    return {
      debug,
      run: () =>
        controller.start({
          runId: 'report-test',
          workflowDefinition: {
            name: 'report-test',
            version: '1',
            initialState: 'DONE',
            terminalStates: ['DONE'],
            states: { DONE: { type: 'terminal', description: '', transitions: [] } },
          },
          governancePolicy: {},
          roleAssignments: {},
          sources: [],
          runDir: join(root, 'run'),
          reportOutputPath,
        }),
    };
  }

  it('creates directories and writes the final report to both configured destinations', async () => {
    const destination = join(root, 'nested', 'report.md');
    const result = await fixture(destination).run();
    expect(result.finalState).toBe('DONE');
    expect(readFileSync(destination, 'utf8')).toBe(renderReport(result.manifest));
    expect(readFileSync(join(root, 'run', 'report.md'), 'utf8')).toBe(
      renderReport(result.manifest),
    );
  });

  it('keeps completion and the run report when an additional report destination cannot be written', async () => {
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'keep this file');
    const destination = join(blocker, 'report.md');
    const { run, debug } = fixture(destination);
    const result = await run();
    expect(result.finalState).toBe('DONE');
    expect(readFileSync(blocker, 'utf8')).toBe('keep this file');
    expect(readFileSync(join(root, 'run', 'report.md'), 'utf8')).toBe(
      renderReport(result.manifest),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining(`Report write failed for ${destination}`),
    );
  });
});
