import { exec, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeCursorProbeResult,
  normalizeCodexProbeResult,
  normalizeGhCliProbeResult,
  normalizeProbeResult,
  probeClaudeCodeCapabilities,
  probeCodexCliCapabilities,
  probeCursorCliCapabilities,
  probeGhCliCapabilities,
} from '@ai-dev-orchestrator/agent-adapters';
import { loadRunnerRegistry } from '@ai-dev-orchestrator/config-templates';
import { createLogger } from '@ai-dev-orchestrator/core';
import {
  DashboardHttpServer,
  DefaultDashboardDataProvider,
  FilesystemSettingsProvider,
  SseEventStream,
} from '@ai-dev-orchestrator/dashboard-server';
import {
  AgentSessionRegistry,
  CompositeAgentSessionSupervisor,
  DefaultAgentSessionStore,
  FileBackedAgentStreamBus,
  FileBackedLiveRequestStore,
  FileBackedPermissionApprovalStore,
  LocalAgentSessionSupervisor,
  RemoteAgentSessionSupervisor,
} from '@ai-dev-orchestrator/runner';
import { BUILT_IN_CODING_RUNNER_ID } from '@ai-dev-orchestrator/schemas';

import { buildDataSources, startJournalPoller } from '../dashboard/data-sources';
import type { RunnerHealthEntry } from '../dashboard/data-sources';
import { DefaultDashboardActionHandler } from '../dashboard/default-dashboard-action-handler';
import { ExitCode } from '../output/exit-codes';
import type { OutputFormatter } from '../output/formatter';
import { loadProjectConfig } from '../project-config';
import {
  getAiDir,
  getDashboardLogPath,
  getPermissionApprovalsPath,
  getRunsDir,
  getScriptsDir,
} from '../workspace-paths';

import { initCommand } from './init';

export interface DashboardOptions {
  readonly port: number;
  readonly host: string;
  readonly open: boolean;
  readonly json: boolean;
  readonly verbose: boolean;
}

function findDashboardDir(): string | null {
  const cliPkgDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const candidate = resolve(cliPkgDir, '..', 'dashboard');
  if (existsSync(join(candidate, 'package.json'))) {
    return candidate;
  }
  return null;
}

function openBrowser(url: string): void {
  let cmd = 'xdg-open';
  if (process.platform === 'darwin') {
    cmd = 'open';
  } else if (process.platform === 'win32') {
    cmd = 'start';
  }
  exec(`${cmd} ${url}`);
}

export async function dashboardCommand(
  options: DashboardOptions,
  formatter: OutputFormatter,
): Promise<ExitCode> {
  const dashboardDir = findDashboardDir();

  if (!dashboardDir) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: 'Dashboard package not found.',
      remediation: 'The dashboard package should be at packages/dashboard/ in the monorepo.',
    });
    return ExitCode.GENERAL_ERROR;
  }

  const aiDir = getAiDir();
  if (!existsSync(aiDir)) {
    formatter.info('No configuration found — running init...');
    const initResult = initCommand({ force: false, json: false, verbose: false }, formatter);
    if (initResult !== ExitCode.SUCCESS) {
      return initResult;
    }
  }

  const runsDir = getRunsDir();
  const agentStreamBus = new FileBackedAgentStreamBus(runsDir);
  const liveRequestStore = new FileBackedLiveRequestStore(runsDir);

  const runnerHealthEntries: RunnerHealthEntry[] = [];
  try {
    const claudeProbe = await probeClaudeCodeCapabilities();
    const { mode, summary } = normalizeProbeResult(claudeProbe);
    const available = mode !== 'unavailable';
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
      available,
      status: available ? 'healthy' : 'degraded',
      summary,
      version: claudeProbe.rawVersion ?? undefined,
    });
  } catch {
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CLAUDE_CODE,
      available: false,
      status: 'degraded',
      summary: 'Probe failed — claude-code adapter unavailable',
    });
  }
  try {
    const codexProbe = await probeCodexCliCapabilities();
    const { mode, summary } = normalizeCodexProbeResult(codexProbe);
    const available = mode !== 'unavailable' && mode !== 'unauthenticated';
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CODEX,
      available,
      status: mode === 'unauthenticated' ? 'unhealthy' : available ? 'healthy' : 'degraded',
      summary,
      version: codexProbe.rawVersion ?? undefined,
    });
  } catch {
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CODEX,
      available: false,
      status: 'degraded',
      summary: 'Probe failed — Codex CLI adapter unavailable',
    });
  }
  try {
    const cursorProbe = await probeCursorCliCapabilities();
    const { mode, summary } = normalizeCursorProbeResult(cursorProbe);
    const available = mode !== 'unavailable' && mode !== 'unauthenticated';
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CURSOR,
      available,
      status: mode === 'unauthenticated' ? 'unhealthy' : available ? 'healthy' : 'degraded',
      summary,
      version: cursorProbe.rawVersion ?? undefined,
    });
  } catch {
    runnerHealthEntries.push({
      id: BUILT_IN_CODING_RUNNER_ID.CURSOR,
      available: false,
      status: 'degraded',
      summary: 'Probe failed — cursor CLI adapter unavailable',
    });
  }
  try {
    const ghProbe = await probeGhCliCapabilities();
    const { mode, summary } = normalizeGhCliProbeResult(ghProbe);
    const available = mode !== 'unavailable';
    runnerHealthEntries.push({
      id: 'gh-cli',
      available,
      status: available ? 'healthy' : 'degraded',
      summary,
      version: ghProbe.rawVersion ?? undefined,
    });
  } catch {
    runnerHealthEntries.push({
      id: 'gh-cli',
      available: false,
      status: 'degraded',
      summary: 'Probe failed — GitHub CLI not available',
    });
  }

  const sources = buildDataSources(runnerHealthEntries);
  const dataProvider = new DefaultDashboardDataProvider(sources);
  const eventStream = new SseEventStream();
  const journalPoller = startJournalPoller(eventStream);
  const sessionStore = new DefaultAgentSessionStore(runsDir);
  const sessionRegistry = new AgentSessionRegistry(sessionStore);
  const dashboardLocalSupervisor = new LocalAgentSessionSupervisor(sessionRegistry);
  const dashboardRemoteSupervisor = new RemoteAgentSessionSupervisor(sessionRegistry);
  const dashboardSupervisor = new CompositeAgentSessionSupervisor([
    dashboardLocalSupervisor,
    dashboardRemoteSupervisor,
  ]);
  const actionHandler = new DefaultDashboardActionHandler(dashboardSupervisor, agentStreamBus);
  const config = loadProjectConfig();
  const settingsProvider = new FilesystemSettingsProvider(aiDir, config, loadRunnerRegistry());
  const dashboardLogger = createLogger(config.runtime.logLevel, getDashboardLogPath());
  const approvalStore = new FileBackedPermissionApprovalStore(getPermissionApprovalsPath());
  await approvalStore.reload();
  const server = new DashboardHttpServer({
    config: { port: options.port, host: options.host, runsDir, scriptsDir: getScriptsDir() },
    dataProvider,
    eventStream,
    agentStreamBus,
    liveRequestStore,
    actionHandler,
    settingsProvider,
    approvalStore,
    logger: dashboardLogger,
  });

  try {
    await server.start();
  } catch (e: unknown) {
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: `Failed to start API server: ${e instanceof Error ? e.message : String(e)}`,
      remediation: `Check if port ${String(options.port)} is already in use.`,
    });
    return ExitCode.GENERAL_ERROR;
  }

  formatter.info(`API server running on http://${options.host}:${String(options.port)}`);

  let viteProcess: ChildProcess | null = null;

  try {
    viteProcess = spawn('npx', ['vite', '--host', '127.0.0.1'], {
      cwd: dashboardDir,
      stdio: ['pipe', 'pipe', options.verbose ? 'inherit' : 'pipe'],
      shell: true,
    });

    viteProcess.on('error', (err) => {
      formatter.error({
        code: ExitCode.GENERAL_ERROR,
        message: `Vite process error: ${err.message}`,
        remediation: 'Run pnpm install first to install dashboard dependencies.',
      });
    });

    const VITE_STARTUP_TIMEOUT_MS = 15000;
    const dashboardUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve('http://localhost:5173');
      }, VITE_STARTUP_TIMEOUT_MS);

      viteProcess?.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (options.verbose) {
          process.stdout.write(output);
        }
        const match = /Local:\s+(https?:\/\/[^\s]+)/u.exec(output);
        if (match?.[1]) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });

      viteProcess?.on('close', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Vite exited with code ${String(code)}`));
      });
    });

    formatter.info(`Dashboard running on ${dashboardUrl}`);

    if (options.open) {
      openBrowser(dashboardUrl);
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify({
          apiUrl: `http://${options.host}:${String(options.port)}`,
          dashboardUrl,
          pid: process.pid,
        }) + '\n',
      );
    }

    // Block until SIGINT/SIGTERM
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        formatter.info('\nShutting down...');
        resolve();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  } finally {
    journalPoller.stop();
    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill('SIGTERM');
    }
    agentStreamBus.dispose();
    await server.stop();
  }

  return ExitCode.SUCCESS;
}
