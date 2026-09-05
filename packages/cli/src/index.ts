import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from '@ai-dev-orchestrator/utils';
import { Command } from 'commander';

import { abortCommand } from './commands/abort';
import { answerCommand } from './commands/answer';
import { approveCommand } from './commands/approve';
import { artifactsCommand } from './commands/artifacts';
import { codexPermissionHookCommand } from './commands/codex-permission-hook';
import { configShowCommand } from './commands/config-show';
import { dashboardCommand } from './commands/dashboard';
import { initCommand } from './commands/init';
import { inspectCommand } from './commands/inspect';
import { killCommand } from './commands/kill';
import { listCommand } from './commands/list';
import { permitCommand } from './commands/permit';
import { resumeCommand } from './commands/resume';
import { retryCommand } from './commands/retry';
import { runCommand } from './commands/run';
import { statusCommand } from './commands/status';
import { validateCommand } from './commands/validate';
import { collectVersionInfo, versionCommand } from './commands/version';
import { ExitCode } from './output/exit-codes';
import { OutputFormatter } from './output/formatter';

const COMMANDER_USER_ERROR_CODES = new Set([
  'commander.unknownCommand',
  'commander.missingArgument',
  'commander.unknownOption',
  'commander.invalidArgument',
  'commander.excessArguments',
  'commander.missingMandatoryOptionValue',
  'commander.optionMissingArgument',
  'commander.conflictingOption',
]);

interface GlobalOpts {
  json?: boolean;
  verbose?: boolean;
  color?: boolean;
}

interface RepoOpts {
  repo?: string;
}

function createFormatter(opts: GlobalOpts): OutputFormatter {
  return new OutputFormatter({
    json: opts.json,
    noColor: opts.color === false,
    verbose: opts.verbose,
  });
}

function resolveGlobalOpts(opts: GlobalOpts): { json: boolean; verbose: boolean } {
  return { json: opts.json ?? false, verbose: opts.verbose ?? false };
}

function resolveRepoRoot(opts: RepoOpts): string {
  return opts.repo ?? process.cwd();
}

function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new TypeError(`"${value}" is not a valid number.`);
  }
  return n;
}

const program = new Command();

program
  .name('ai')
  .description('AI Dev Orchestrator CLI')
  .version(collectVersionInfo().version, '-v, --version')
  .option('--json', 'Machine-readable JSON output')
  .option('--verbose', 'Debug-level output')
  .option('--no-color', 'Disable terminal colors')
  .exitOverride()
  .configureOutput({
    writeErr: (str) => {
      const formatter = new OutputFormatter({
        json: process.argv.includes('--json'),
        noColor: process.argv.includes('--no-color'),
        verbose: process.argv.includes('--verbose'),
      });
      formatter.error({
        code: ExitCode.INVALID_ARGUMENTS,
        message: str.trim(),
        remediation: 'Run `ai --help` to see available commands.',
      });
    },
  });

program
  .command('init')
  .description('Initialize the global ~/.ai/ configuration directory')
  .option('-f, --force', 'Overwrite existing ~/.ai/ directory')
  .action(function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts & { force?: boolean }>();
    const formatter = createFormatter(opts);
    process.exitCode = initCommand(
      { force: opts.force ?? false, ...resolveGlobalOpts(opts) },
      formatter,
    );
  });

program
  .command('run')
  .description('Start a new workflow run')
  .argument('[sources...]', 'Input sources')
  .option('--repo <path>', 'Repository path context (defaults to a temp directory)')
  .option('--dry-run', 'Validate configuration without starting')
  .option('-w, --workflow <name>', 'Workflow to use (e.g., dev, pr-review)')
  .option('--source <refs...>', 'Typed source (e.g., jira:PROJ-123, github:owner/repo#42)')
  .action(async function (this: Command, positionals: string[]) {
    const opts = this.optsWithGlobals<
      GlobalOpts & RepoOpts & { dryRun?: boolean; source?: string[]; workflow?: string }
    >();
    const formatter = createFormatter(opts);
    const allSources = [...positionals, ...(opts.source ?? [])];
    process.exitCode = await runCommand(
      resolveRepoRoot(opts),
      {
        sources: allSources,
        dryRun: opts.dryRun ?? false,
        workflow: opts.workflow,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('resume')
  .description('Resume an interrupted run')
  .argument('[runId]', 'Run ID to resume')
  .option('--repo <path>', 'Repository path context (defaults to a temp directory)')
  .action(async function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & RepoOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = await resumeCommand(
      resolveRepoRoot(opts),
      {
        runId: runId ?? null,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('retry')
  .description('Retry an aborted or failed run from the state that caused the failure')
  .argument('<runId>', 'Run ID to retry')
  .option('--repo <path>', 'Repository path context (defaults to a temp directory)')
  .action(async function (this: Command, runId: string) {
    const opts = this.optsWithGlobals<GlobalOpts & RepoOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = await retryCommand(
      resolveRepoRoot(opts),
      {
        runId,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('abort')
  .description('Abort a running or paused run')
  .argument('[runId]', 'Run ID to abort')
  .option('-f, --force', 'Skip confirmation')
  .action(async function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & { force?: boolean }>();
    const formatter = createFormatter(opts);
    process.exitCode = await abortCommand(
      {
        runId: runId ?? null,
        force: opts.force ?? false,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('kill')
  .description('Kill all active run processes on this machine')
  .action(async function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = await killCommand({ ...resolveGlobalOpts(opts) }, formatter);
  });

program
  .command('status')
  .description('Display current run state and progress')
  .argument('[runId]', 'Run ID to check')
  .option('-w, --watch', 'Continuous polling mode')
  .option('--follow', 'Continuous polling mode (alias)')
  .action(async function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & { watch?: boolean; follow?: boolean }>();
    const formatter = createFormatter(opts);
    process.exitCode = await statusCommand(
      {
        runId: runId ?? null,
        watch: (opts.watch ?? false) || (opts.follow ?? false),
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('version')
  .description('Display version, commit SHA, and build info')
  .action(function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = versionCommand({ ...resolveGlobalOpts(opts) }, formatter);
  });

program
  .command('list')
  .description('List past runs with status')
  .option('--status <status>', 'Filter by run status')
  .option('--limit <n>', 'Maximum number of runs to display', parseIntOption, 0)
  .action(function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts & { status?: string; limit: number }>();
    const formatter = createFormatter(opts);
    process.exitCode = listCommand(
      {
        status: opts.status ?? null,
        limit: opts.limit,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('inspect')
  .description('Display detailed run information')
  .argument('[runId]', 'Run ID to inspect')
  .action(function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = inspectCommand(
      {
        runId: runId ?? null,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('artifacts')
  .description('Display artifact inventory for a run')
  .argument('[runId]', 'Run ID')
  .option('--type <type>', 'Filter by artifact type')
  .action(function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & { type?: string }>();
    const formatter = createFormatter(opts);
    process.exitCode = artifactsCommand(
      {
        runId: runId ?? null,
        type: opts.type ?? null,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('validate')
  .description('Validate configuration without starting')
  .action(function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = validateCommand({ ...resolveGlobalOpts(opts) }, formatter);
  });

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('show')
  .description('Display merged configuration')
  .action(function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts>();
    const formatter = createFormatter(opts);
    process.exitCode = configShowCommand({ ...resolveGlobalOpts(opts) }, formatter);
  });

program
  .command('dashboard')
  .description('Open the dashboard web UI')
  .option('--port <number>', 'API server port', parseIntOption, 9100)
  .option('--host <addr>', 'API server host', '127.0.0.1')
  .option('--no-open', "Don't open browser automatically")
  .action(async function (this: Command) {
    const opts = this.optsWithGlobals<GlobalOpts & { port: number; host: string; open: boolean }>();
    const formatter = createFormatter(opts);
    process.exitCode = await dashboardCommand(
      {
        port: opts.port,
        host: opts.host,
        open: opts.open,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('approve')
  .description('Approve a waiting human gate')
  .argument('[runId]', 'Run ID')
  .option('--reject', 'Reject instead of approve')
  .option('--message <text>', 'Approval/rejection note')
  .action(async function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & { reject?: boolean; message?: string }>();
    const formatter = createFormatter(opts);
    process.exitCode = await approveCommand(
      {
        runId: runId ?? null,
        reject: opts.reject ?? false,
        message: opts.message ?? null,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('answer')
  .description('Answer clarification questions')
  .argument('[runId]', 'Run ID')
  .argument('[answers...]', 'Answers to provide')
  .option('--input-file <path>', 'Read answers from file')
  .option('--message-id <id>', 'Target a specific pending clarification request')
  .action(async function (this: Command, runId?: string, answers?: string[]) {
    const opts = this.optsWithGlobals<GlobalOpts & { inputFile?: string; messageId?: string }>();
    const formatter = createFormatter(opts);
    process.exitCode = await answerCommand(
      {
        runId: runId ?? null,
        inputFile: opts.inputFile ?? null,
        messageId: opts.messageId ?? null,
        answers: answers ?? [],
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('permit')
  .description('Approve or deny a live permission request')
  .argument('[runId]', 'Run ID')
  .option('--deny', 'Deny the permission request')
  .option('--message-id <id>', 'Target a specific pending request')
  .action(async function (this: Command, runId?: string) {
    const opts = this.optsWithGlobals<GlobalOpts & { deny?: boolean; messageId?: string }>();
    const formatter = createFormatter(opts);
    process.exitCode = await permitCommand(
      {
        runId: runId ?? null,
        deny: opts.deny ?? false,
        messageId: opts.messageId ?? null,
        ...resolveGlobalOpts(opts),
      },
      formatter,
    );
  });

program
  .command('codex-permission-hook', { hidden: true })
  .description('Codex PermissionRequest hook bridge invoked by codex exec')
  .action(async function () {
    process.exitCode = await codexPermissionHookCommand();
  });

function createEarlyFormatter(): OutputFormatter {
  return new OutputFormatter({
    json: process.argv.includes('--json'),
    noColor: process.argv.includes('--no-color'),
    verbose: process.argv.includes('--verbose'),
  });
}

function logCrash(label: string, err: unknown): void {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  const line = `[${new Date().toISOString()}] ${label}: ${message}\n`;
  process.stderr.write(line);
  try {
    const runsDir = join(process.env['AI_ORCHESTRATOR_HOME'] ?? join(process.cwd(), '.ai'), 'runs');
    appendFileSync(join(runsDir, 'crash.log'), line);
  } catch {
    // best-effort
  }
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err);
  process.exitCode = ExitCode.RUN_FAILED;
});
process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason);
  process.exitCode = ExitCode.RUN_FAILED;
});

program.parseAsync(process.argv).catch((error: unknown) => {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') {
    const formatter = createEarlyFormatter();
    formatter.error({
      code: ExitCode.GENERAL_ERROR,
      message: getErrorMessage(error),
      remediation: 'An unexpected error occurred. Please report this issue.',
      detail: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = ExitCode.GENERAL_ERROR;
    return;
  }

  if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
    return;
  }

  if (COMMANDER_USER_ERROR_CODES.has(error.code)) {
    process.exitCode = ExitCode.INVALID_ARGUMENTS;
    return;
  }

  const formatter = createEarlyFormatter();
  formatter.error({
    code: ExitCode.GENERAL_ERROR,
    message: error.message,
    remediation: 'An unexpected error occurred. Please report this issue.',
    detail: error.stack,
  });
  process.exitCode = ExitCode.GENERAL_ERROR;
});
