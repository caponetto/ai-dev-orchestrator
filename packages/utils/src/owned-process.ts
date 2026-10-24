import type { ChildProcess } from 'node:child_process';

const exitHooks = new Set<() => void>();
function onParentExit(): void {
  for (const hook of [...exitHooks]) {
    hook();
  }
}
function registerExitHook(hook: () => void): () => void {
  if (exitHooks.size === 0) {
    process.on('exit', onParentExit);
  }
  exitHooks.add(hook);
  return () => {
    exitHooks.delete(hook);
    if (exitHooks.size === 0) {
      process.removeListener('exit', onParentExit);
    }
  };
}

/** Own only a child spawned by this execution, and optionally its explicitly private POSIX group. */
export class OwnedProcess {
  readonly closed: Promise<void>;
  readonly pid: number | undefined;
  private readonly groupId: number | undefined;
  private readonly releaseExitHook: () => void;
  private readonly graceMs: number;
  private exited = false;
  private childClosed = false;
  private stopping = false;
  private terminationFinished = false;
  private finished = false;
  private escalation: ReturnType<typeof setTimeout> | undefined;
  private polling: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private resolveClosed!: () => void;

  constructor(
    private readonly child: ChildProcess,
    options: {
      readonly ownsGroup?: boolean;
      readonly graceMs?: number;
      readonly timeoutMs?: number;
    } = {},
  ) {
    this.pid = child.pid;
    if (
      this.pid !== undefined &&
      (!Number.isSafeInteger(this.pid) ||
        this.pid <= 1 ||
        this.pid > 0x7fff_ffff ||
        this.pid === process.pid)
    ) {
      throw new Error('Owned process must have a valid child PID');
    }
    this.groupId =
      options.ownsGroup === true && process.platform !== 'win32' ? this.pid : undefined;
    this.graceMs = options.graceMs ?? 5000;
    if (!Number.isFinite(this.graceMs) || this.graceMs < 0) {
      throw new Error('Invalid process termination grace');
    }
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    this.releaseExitHook = registerExitHook(() => {
      if (!this.finished && !this.terminationFinished) {
        this.signal('SIGKILL');
      }
    });
    child.once('exit', this.onExit);
    child.once('close', this.onClose);
    child.on('error', this.onError);
    if (options.timeoutMs !== undefined) {
      this.timeout = setTimeout(() => {
        this.kill();
      }, options.timeoutMs);
    }
  }

  private readonly onExit = (): void => {
    this.exited = true;
    this.kill();
  };
  private readonly onClose = (): void => {
    this.exited = true;
    this.childClosed = true;
    this.kill();
    this.finish();
  };
  private readonly onError = (): void => {
    if (this.pid === undefined) {
      this.exited = true;
      this.childClosed = true;
      this.terminationFinished = true;
      this.finish();
    }
  };

  /** Idempotent TERM-to-KILL escalation; child.killed is deliberately never used as liveness. */
  kill(): boolean {
    if (this.finished || this.stopping) {
      return false;
    }
    this.stopping = true;
    if (!this.alive()) {
      this.terminationFinished = true;
      this.finish();
      return false;
    }
    const sent = this.signal('SIGTERM');
    this.escalation = setTimeout(() => {
      if (this.finished || this.terminationFinished) {
        return;
      }
      if (!this.alive() || this.signal('SIGKILL')) {
        // SIGKILL completes the group policy; native close is still required before releasing ownership.
        // Grandchild zombies may remain until the OS reaper runs, so kill(group, 0) alone cannot gate release.
        this.terminationFinished = true;
        this.finish();
      }
    }, this.graceMs);
    this.polling = setInterval(() => {
      if (this.finished || this.terminationFinished) {
        return;
      }
      if (!this.alive()) {
        this.terminationFinished = true;
        this.finish();
      }
    }, 25);
    return sent;
  }

  private alive(): boolean {
    if (this.groupId === undefined) {
      return !this.exited;
    }
    try {
      process.kill(-this.groupId, 0);
      return true;
    } catch (error: unknown) {
      return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
    }
  }

  private signal(signal: 'SIGTERM' | 'SIGKILL'): boolean {
    try {
      if (this.groupId !== undefined) {
        return process.kill(-this.groupId, signal);
      }
      return this.child.kill(signal);
    } catch (error: unknown) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH';
    }
  }

  private finish(): void {
    if (!this.terminationFinished) {
      return;
    }
    clearTimeout(this.escalation);
    clearInterval(this.polling);
    clearTimeout(this.timeout);
    if (!this.childClosed || this.finished) {
      return;
    }
    this.finished = true;
    this.releaseExitHook();
    this.child.removeListener('exit', this.onExit);
    this.child.removeListener('close', this.onClose);
    this.child.removeListener('error', this.onError);
    this.resolveClosed();
  }
}
