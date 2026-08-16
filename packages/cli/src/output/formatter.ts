import type { CLIError } from './exit-codes';

export interface FormatOptions {
  readonly json: boolean;
  readonly noColor: boolean;
  readonly verbose: boolean;
}

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const;

function isTTY(): boolean {
  return process.stdout.isTTY && process.env['NO_COLOR'] === undefined;
}

/** TTY-aware formatter handling colored output, JSON mode, and spinner animations. */
export class OutputFormatter {
  private readonly options: FormatOptions;
  private readonly colorEnabled: boolean;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: Partial<FormatOptions> = {}) {
    this.options = {
      json: options.json ?? false,
      noColor: options.noColor ?? false,
      verbose: options.verbose ?? false,
    };
    this.colorEnabled = !this.options.json && !this.options.noColor && isTTY();
  }

  print(data: Record<string, unknown>): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify(data) + '\n');
      return;
    }
    for (const [key, value] of Object.entries(data)) {
      process.stdout.write(`${this.color(key + ':', 'cyan')} ${String(value)}\n`);
    }
  }

  progress(message: string): void {
    if (this.options.json) {
      return;
    }
    this.clearSpinner();
    if (isTTY()) {
      process.stdout.write(`\r${this.color('●', 'blue')} ${message}`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  }

  stateTransition(from: string, to: string): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ event: 'transition', from, to }) + '\n');
      return;
    }
    process.stdout.write(
      `  ${this.color(from, 'dim')} ${this.color('→', 'yellow')} ${this.color(to, 'bold')}\n`,
    );
  }

  workerDispatch(role: string, state: string): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ event: 'worker_dispatch', role, state }) + '\n');
      return;
    }
    if (this.options.verbose) {
      process.stdout.write(`  ${this.color('▸', 'cyan')} ${role} dispatched in ${state}\n`);
    }
  }

  workerComplete(role: string, success: boolean): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ event: 'worker_complete', role, success }) + '\n');
      return;
    }
    if (this.options.verbose) {
      const icon = success ? this.color('✓', 'green') : this.color('✗', 'red');
      process.stdout.write(`  ${icon} ${role} ${success ? 'completed' : 'failed'}\n`);
    }
  }

  startSpinner(message: string): void {
    if (!isTTY() || this.options.json) {
      return;
    }
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    this.spinnerInterval = setInterval(() => {
      const frame = frames[i % frames.length] ?? '⠋';
      process.stdout.write(`\r${this.color(frame, 'cyan')} ${message}`);
      i++;
    }, 80);
  }

  clearSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
      if (isTTY()) {
        process.stdout.write('\r\x1b[K');
      }
    }
  }

  success(message: string): void {
    this.clearSpinner();
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ status: 'success', message }) + '\n');
      return;
    }
    process.stdout.write(`${this.color('✓', 'green')} ${message}\n`);
  }

  error(err: CLIError): void {
    this.clearSpinner();
    if (this.options.json) {
      process.stderr.write(JSON.stringify({ error: err }) + '\n');
      return;
    }
    process.stderr.write(
      `\n${this.color('Error', 'red')}${this.color(':', 'red')} ${err.message}\n`,
    );
    process.stderr.write(`${this.color('Remediation:', 'yellow')} ${err.remediation}\n`);
    if (this.options.verbose && err.detail) {
      const detail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
      process.stderr.write(`\n${this.color('Detail:', 'dim')} ${detail}\n`);
    }
  }

  warn(message: string): void {
    if (this.options.json) {
      process.stderr.write(JSON.stringify({ warning: message }) + '\n');
      return;
    }
    process.stderr.write(`${this.color('⚠', 'yellow')} ${message}\n`);
  }

  info(message: string): void {
    if (this.options.json) {
      return;
    }
    process.stdout.write(`${this.color('ℹ', 'blue')} ${message}\n`);
  }

  summary(data: Record<string, unknown>): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify(data) + '\n');
      return;
    }
    process.stdout.write(`\n${this.color('── Run Summary ──', 'bold')}\n`);
    for (const [key, value] of Object.entries(data)) {
      process.stdout.write(`  ${this.color(key + ':', 'cyan')} ${String(value)}\n`);
    }
    process.stdout.write('\n');
  }

  section(title: string): void {
    if (this.options.json) {
      return;
    }
    process.stdout.write(`\n${this.color(`── ${title} ──`, 'bold')}\n`);
  }

  keyValue(pairs: Record<string, unknown>): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify(pairs) + '\n');
      return;
    }
    for (const [key, value] of Object.entries(pairs)) {
      process.stdout.write(`  ${this.color(key + ':', 'cyan')} ${String(value)}\n`);
    }
  }

  table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ headers, rows }) + '\n');
      return;
    }

    const widths = headers.map((h, i) => {
      const colValues = rows.map((r) => r[i] ?? '');
      return Math.max(h.length, ...colValues.map((v) => v.length));
    });

    const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join('  ');
    process.stdout.write(`  ${this.color(headerLine, 'dim')}\n`);

    for (const row of rows) {
      const line = headers.map((_, i) => (row[i] ?? '').padEnd(widths[i] ?? 0)).join('  ');
      process.stdout.write(`  ${line}\n`);
    }
  }

  progressBar(label: string, current: number, total: number): void {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    if (this.options.json) {
      process.stdout.write(JSON.stringify({ label, current, total, percent }) + '\n');
      return;
    }

    const barWidth = 20;
    const filled = total > 0 ? Math.round((current / total) * barWidth) : 0;
    const empty = barWidth - filled;
    const bar = `${this.color('█'.repeat(filled), 'green')}${this.color('░'.repeat(empty), 'dim')}`;

    if (isTTY()) {
      process.stdout.write(`\r  [${bar}] ${String(percent)}% ${label}`);
    } else {
      process.stdout.write(
        `  ${label}: ${String(percent)}% (${String(current)}/${String(total)})\n`,
      );
    }
  }

  private color(text: string, color: keyof typeof COLORS): string {
    if (!this.colorEnabled) {
      return text;
    }
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }
}
