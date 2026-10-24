import { createInterface } from 'node:readline';
import type { Interface as ReadlineInterface } from 'node:readline';

import type { LiveRequest, LiveRequestStore } from '@ai-dev-orchestrator/runner';
import { getErrorMessage } from '@ai-dev-orchestrator/utils';

import type { OutputFormatter } from '../output/formatter';

interface ActivePrompt {
  readonly request: LiveRequest;
  readonly input: ReadlineInterface;
  submitting: boolean;
}

/** Owns one terminal question at a time; the store arbitrates competing response writers. */
class LiveRequestPrompter {
  private stopped = false;
  private polling = false;
  private active: ActivePrompt | null = null;
  private readonly completed = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly runId: string,
    private readonly store: LiveRequestStore,
    private readonly formatter: OutputFormatter,
  ) {
    this.timer = setInterval(() => {
      void this.poll();
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.closePrompt();
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private closePrompt(): void {
    const prompt = this.active;
    this.active = null;
    prompt?.input.close();
  }

  private async poll(): Promise<void> {
    if (this.isStopped() || this.polling) {
      return;
    }
    this.polling = true;
    try {
      const pending = await this.store.listPendingRequests(this.runId);
      if (this.isStopped() || this.active?.submitting) {
        return;
      }
      let dismissed = false;
      if (
        this.active &&
        !pending.some((request) => request.messageId === this.active?.request.messageId)
      ) {
        const id = this.active.request.messageId;
        this.closePrompt();
        this.formatter.info(
          `Live request ${id} is no longer pending; terminal response not submitted.`,
        );
        dismissed = true;
      }
      if (this.active) {
        return;
      }
      const request = pending.find((entry) => !this.completed.has(entry.messageId));
      if (request) {
        this.openPrompt(request);
      } else if (dismissed) {
        this.formatter.startSpinner('Running workflow…');
      }
    } catch (error: unknown) {
      if (!this.isStopped()) {
        this.formatter.warn(`Unable to read live requests: ${getErrorMessage(error)}. Retrying.`);
      }
    } finally {
      this.polling = false;
    }
  }

  private openPrompt(request: LiveRequest): void {
    this.formatter.clearSpinner();
    const payload = request.payload;
    const field = (key: string, fallback = ''): string =>
      typeof payload[key] === 'string' ? payload[key] : fallback;
    const question =
      request.kind === 'permission'
        ? `? ${field('action', 'unknown')} ${field('resource')} (${field('riskLevel', 'unknown')} risk). Allow? [Y/n] `
        : `? ${field('question')} `;
    if (request.kind === 'permission' && field('detail')) {
      this.formatter.info(`  Detail: ${field('detail')}`);
    }
    const input = createInterface({ input: process.stdin, output: process.stdout });
    const prompt: ActivePrompt = { request, input, submitting: false };
    this.active = prompt;
    input.once('close', () => {
      if (this.isStopped() || this.active !== prompt || prompt.submitting) {
        return;
      }
      this.formatter.warn(
        `Terminal input closed. No terminal response submitted for ${request.messageId}; inspect pending requests and use ai permit or ai answer with --message-id.`,
      );
      this.formatter.startSpinner('Running workflow…');
      this.stop();
    });
    try {
      input.question(question, (answer) => {
        void this.submit(prompt, answer);
      });
    } catch (error: unknown) {
      this.closePrompt();
      throw error;
    }
  }

  private async submit(prompt: ActivePrompt, answer: string): Promise<void> {
    if (this.isStopped() || this.active !== prompt || prompt.submitting) {
      return;
    }
    prompt.submitting = true;
    prompt.input.close();
    const request = prompt.request;
    try {
      let payload: Record<string, unknown>;
      if (request.kind === 'permission') {
        const decision = answer.trim().toLowerCase();
        if (!['', 'y', 'yes', 'n', 'no'].includes(decision)) {
          this.formatter.warn('Enter yes or no. No permission response was submitted.');
          return;
        }
        payload = { granted: !['n', 'no'].includes(decision) };
      } else {
        if (!answer.trim()) {
          this.formatter.warn('Enter a non-empty answer. No clarification response was submitted.');
          return;
        }
        payload = { answer };
      }
      const outcome = await this.store.writeResponse(
        {
          runId: this.runId,
          messageId: request.messageId,
          payload,
          respondedAt: new Date().toISOString(),
        },
        { requireRequest: true },
      );
      this.completed.add(request.messageId);
      if (!this.isStopped()) {
        this.formatter.info(
          `Live ${request.kind} response ${outcome === 'already_responded' ? 'already recorded' : 'stored'} (${request.messageId}).`,
        );
      }
    } catch (error: unknown) {
      if (!this.isStopped()) {
        this.formatter.warn(
          `Unable to store live ${request.kind} response (${request.messageId}): ${getErrorMessage(error)}. Pending requests will be offered again.`,
        );
      }
    } finally {
      if (this.active === prompt) {
        this.active = null;
      }
      if (!this.isStopped()) {
        this.formatter.startSpinner('Running workflow…');
      }
    }
  }
}

export function startLiveRequestPrompter(
  runId: string,
  store: LiveRequestStore,
  formatter: OutputFormatter,
): { stop: () => void } {
  const prompter = new LiveRequestPrompter(runId, store, formatter);
  return {
    stop: () => {
      prompter.stop();
    },
  };
}
