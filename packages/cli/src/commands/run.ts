import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

import { safeJsonParse } from '@ai-dev-orchestrator/artifacts';
import type { LiveRequest, LiveRequestStore } from '@ai-dev-orchestrator/runner';
import type { RunResult } from '@ai-dev-orchestrator/schemas';
import { WORKFLOW_DEFINITION_FILENAME } from '@ai-dev-orchestrator/schemas';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

import {
  createOrchestrator,
  createRunConfig,
  loadWorkflowByName,
  loadWorkflowFromConfig,
} from '../composition-root';
import type { ConfigSnapshot } from '../config-snapshot';
import { configSnapshotSchema } from '../config-snapshot';
import { resolveIntakeSources } from '../intake-router';
import { ExitCode, toCLIError } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { resolveProjectWorkflow } from '../project-config';
import { handleWaitingForHuman } from '../waiting-for-human';
import { getArtifactsDir, getConfigSnapshotPath } from '../workspace-paths';

/** Options for the `ai run` command. */
export interface RunOptions {
  readonly sources: readonly string[];
  readonly verbose: boolean;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly workflow?: string;
}

/** Execute a new orchestrator run from CLI sources, looping through human gates. */
export async function runCommand(
  repoRoot: string,
  options: RunOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  if (options.sources.length === 0) {
    formatter.error({
      code: ExitCode.INVALID_ARGUMENTS,
      message: 'No input source provided.',
      remediation: 'Usage: ai run "your prompt here"',
    });
    return ExitCode.INVALID_ARGUMENTS;
  }

  formatter.info(`Starting run with source: ${options.sources[0]}`);

  let ctx;
  try {
    ctx = await createOrchestrator(repoRoot);
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.CONFIGURATION_ERROR;
  }

  // Persist the initial prompt into config-snapshot for the dashboard Chat panel
  const snapshotPath = getConfigSnapshotPath(ctx.runDir);
  try {
    const parsed = safeJsonParse(readFileSync(snapshotPath, 'utf8'), configSnapshotSchema);
    if (!parsed.success) {
      throw new Error(parsed.error);
    }
    const snapshot: ConfigSnapshot = {
      ...parsed.data,
      sources: [...options.sources],
    };
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    // non-critical — chat will just lack the initial prompt
  }

  for (const w of ctx.warnings) {
    formatter.warn(w);
  }
  formatter.info(`Run ID: ${ctx.runId}`);

  const requirements = resolveIntakeSources(options.sources);
  const intakeContent = JSON.stringify(requirements, null, 2);

  const artifactsDir = getArtifactsDir(ctx.runDir);
  mkdirSync(artifactsDir, { recursive: true });
  // Sidecar kept for tools/dashboard orphans that look for this filename.
  writeFileSync(join(artifactsDir, 'intake-requirements.json'), intakeContent, 'utf8');

  try {
    await ctx.artifactStore.store({
      type: 'intake_requirements',
      name: 'intake-requirements',
      runId: ctx.runId,
      content: intakeContent,
      producedBy: 'human',
    });
  } catch (error: unknown) {
    formatter.warn(`Failed to register intake_requirements artifact: ${getErrorMessage(error)}`);
  }

  if (options.dryRun) {
    formatter.success('Dry run complete — configuration is valid.');
    return ExitCode.SUCCESS;
  }

  const workflow = (() => {
    if (options.workflow) {
      const byName = loadWorkflowByName(options.workflow);
      if (byName) {
        return byName;
      }
      formatter.error({
        code: ExitCode.INVALID_ARGUMENTS,
        message: `Unknown workflow: ${options.workflow}`,
        remediation: "Check available built-in workflows or run 'init' to generate defaults.",
      });
      return null;
    }
    return loadWorkflowFromConfig() ?? resolveProjectWorkflow();
  })();
  if (!workflow) {
    return ExitCode.INVALID_ARGUMENTS;
  }

  writeFileSync(join(ctx.runDir, WORKFLOW_DEFINITION_FILENAME), JSON.stringify(workflow), 'utf-8');

  // Update config-snapshot with the resolved workflow name
  try {
    const parsed2 = safeJsonParse(readFileSync(snapshotPath, 'utf8'), configSnapshotSchema);
    if (!parsed2.success) {
      throw new Error(parsed2.error);
    }
    const snapshot: ConfigSnapshot = {
      ...parsed2.data,
      workflow: {
        ...parsed2.data.workflow,
        name: workflow.name,
        version: workflow.version,
        budget: workflow.budget,
      },
    };
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    // non-critical
  }

  const config = createRunConfig(ctx.runId, options.sources, workflow, {
    maxTokens: workflow.budget?.maxTokensPerRun ?? ctx.budgetConfig?.maxTokensPerRun,
    alertThresholds: ctx.budgetConfig?.alertThresholds,
    reportOutputPath: ctx.reportOutputPath,
    runDir: ctx.runDir,
    repoRoot,
  });

  const livePoller = process.stdin.isTTY
    ? startLiveRequestPoller(ctx.runId, ctx.liveRequestStore, formatter)
    : startNonTtyLiveRequestPoller(ctx.runId, ctx.liveRequestStore, formatter);

  const onUncaughtException = (err: Error): void => {
    formatter.error({
      code: ExitCode.RUN_FAILED,
      message: `Uncaught exception: ${err.message}`,
      remediation: 'Check the journal for details.',
    });
    ctx.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      sequence: 0,
      type: 'error',
      data: {
        kind: 'error',
        errorCode: 'uncaught_exception',
        message: err.message,
        recoverable: false,
      },
    });
    process.exitCode = ExitCode.RUN_FAILED;
  };

  const onUnhandledRejection = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason);
    formatter.error({
      code: ExitCode.RUN_FAILED,
      message: `Unhandled rejection: ${message}`,
      remediation: 'Check the journal for details.',
    });
    ctx.journalWriter.append({
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      sequence: 0,
      type: 'error',
      data: {
        kind: 'error',
        errorCode: 'unhandled_rejection',
        message,
        recoverable: false,
      },
    });
    process.exitCode = ExitCode.RUN_FAILED;
  };

  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  formatter.startSpinner('Running workflow…');

  let result: RunResult;
  try {
    result = await ctx.engine.start(config);

    if (result.finalState === 'WAITING_FOR_HUMAN') {
      handleWaitingForHuman(result, ctx.engine, ctx.runId, formatter);
      return ExitCode.SUCCESS;
    }
  } catch (error: unknown) {
    formatter.error(toCLIError(error));
    return ExitCode.RUN_FAILED;
  } finally {
    livePoller.stop();
    ctx.shutdownCoordinator?.uninstall();
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
  }

  formatter.clearSpinner();

  if (result.finalState === 'DONE') {
    formatter.success('Workflow completed successfully.');
    formatter.summary({
      'Run ID': result.runId,
      'Final State': result.finalState,
      Artifacts: result.artifactInventory.length,
    });
    return ExitCode.SUCCESS;
  }

  if (result.finalState === 'FAILED') {
    formatter.error({
      code: ExitCode.RUN_FAILED,
      message: 'Workflow failed due to a process error.',
      remediation: 'Check the journal for details on what failed.',
    });
    return ExitCode.RUN_FAILED;
  }

  if (result.finalState === 'ABORTED') {
    formatter.error({
      code: ExitCode.RUN_ABORTED,
      message: 'Workflow was aborted.',
      remediation: 'Check the journal for details on why the run was aborted.',
    });
    return ExitCode.RUN_ABORTED;
  }

  formatter.summary({
    'Run ID': result.runId,
    'Final State': result.finalState,
    Artifacts: result.artifactInventory.length,
  });
  return ExitCode.SUCCESS;
}

const LIVE_POLL_MS = 1000;

function startLiveRequestPoller(
  runId: string,
  store: LiveRequestStore,
  formatter: OutputFormatter,
): { stop: () => void } {
  const seenIds = new Set<string>();
  let stopped = false;
  const activePrompts = new Set<ReadlineInterface>();
  const isStopped = (): boolean => stopped;

  const timer = setInterval(() => {
    void (async () => {
      if (stopped) {
        return;
      }
      let pending: readonly LiveRequest[];
      try {
        pending = await store.listPendingRequests(runId);
      } catch {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async race: stop() may fire during await
      if (stopped) {
        return;
      }

      for (const req of pending) {
        if (isStopped()) {
          break;
        }
        if (seenIds.has(req.messageId)) {
          continue;
        }
        seenIds.add(req.messageId);

        formatter.clearSpinner();
        const payload = req.payload;

        if (req.kind === 'permission') {
          const action = typeof payload['action'] === 'string' ? payload['action'] : 'unknown';
          const resource = typeof payload['resource'] === 'string' ? payload['resource'] : '';
          const risk = typeof payload['riskLevel'] === 'string' ? payload['riskLevel'] : 'unknown';
          const detail = typeof payload['detail'] === 'string' ? payload['detail'] : '';
          promptPermission({
            runId,
            messageId: req.messageId,
            action,
            resource,
            risk,
            detail,
            store,
            formatter,
            activePrompts,
            isStopped,
          });
        } else {
          const question = typeof payload['question'] === 'string' ? payload['question'] : '';
          promptClarification(
            runId,
            req.messageId,
            question,
            store,
            formatter,
            activePrompts,
            isStopped,
          );
        }
      }
    })();
  }, LIVE_POLL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const rl of activePrompts) {
        rl.close();
      }
      activePrompts.clear();
    },
  };
}

interface PromptPermissionOpts {
  runId: string;
  messageId: string;
  action: string;
  resource: string;
  risk: string;
  detail: string;
  store: LiveRequestStore;
  formatter: OutputFormatter;
  activePrompts: Set<ReadlineInterface>;
  isStopped: () => boolean;
}

function promptPermission(opts: PromptPermissionOpts): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  opts.activePrompts.add(rl);
  if (opts.detail) {
    opts.formatter.info(`  Detail: ${opts.detail}`);
  }
  rl.question(`? ${opts.action} ${opts.resource} (${opts.risk} risk). Allow? [Y/n] `, (answer) => {
    rl.close();
    opts.activePrompts.delete(rl);
    if (opts.isStopped()) {
      return;
    }
    const granted = answer.trim().toLowerCase() !== 'n';
    void opts.store.writeResponse({
      runId: opts.runId,
      messageId: opts.messageId,
      payload: { granted },
      respondedAt: new Date().toISOString(),
    });
    opts.formatter.info(granted ? 'Approved.' : 'Denied.');
    opts.formatter.startSpinner('Running workflow…');
  });
}

function promptClarification(
  runId: string,
  messageId: string,
  question: string,
  store: LiveRequestStore,
  formatter: OutputFormatter,
  activePrompts: Set<ReadlineInterface>,
  isStopped: () => boolean,
): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  activePrompts.add(rl);
  formatter.info(`? ${question}`);
  rl.question('  Answer: ', (answer) => {
    rl.close();
    activePrompts.delete(rl);
    if (isStopped()) {
      return;
    }
    void store.writeResponse({
      runId,
      messageId,
      payload: { answer },
      respondedAt: new Date().toISOString(),
    });
    formatter.info('Answer submitted.');
    formatter.startSpinner('Running workflow…');
  });
}

function startNonTtyLiveRequestPoller(
  runId: string,
  store: LiveRequestStore,
  formatter: OutputFormatter,
): { stop: () => void } {
  const seenIds = new Set<string>();
  let stopped = false;

  const timer = setInterval(() => {
    void (async () => {
      if (stopped) {
        return;
      }
      let pending: readonly LiveRequest[];
      try {
        pending = await store.listPendingRequests(runId);
      } catch {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async race: stop() may fire during await
      if (stopped) {
        return;
      }

      for (const req of pending) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- async race: stop() may fire during iteration
        if (stopped) {
          break;
        }
        if (seenIds.has(req.messageId)) {
          continue;
        }
        seenIds.add(req.messageId);

        formatter.clearSpinner();
        const payload = req.payload;

        if (req.kind === 'permission') {
          const action = typeof payload['action'] === 'string' ? payload['action'] : 'unknown';
          const resource = typeof payload['resource'] === 'string' ? payload['resource'] : '';
          const risk = typeof payload['riskLevel'] === 'string' ? payload['riskLevel'] : 'unknown';
          formatter.info(`Permission requested: ${action} ${resource} (${risk} risk)`);
          formatter.info(`  Approve: ai permit ${runId} --message-id ${req.messageId}`);
          formatter.info(`  Deny:    ai permit ${runId} --message-id ${req.messageId} --deny`);
        } else {
          const question = typeof payload['question'] === 'string' ? payload['question'] : '';
          formatter.info(`Clarification requested: ${question}`);
          formatter.info(
            `  Respond: ai answer ${runId} --message-id ${req.messageId} "your answer"`,
          );
        }

        formatter.startSpinner('Running workflow…');
      }
    })();
  }, LIVE_POLL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
