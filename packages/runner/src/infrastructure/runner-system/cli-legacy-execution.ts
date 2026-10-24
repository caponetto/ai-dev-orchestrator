import type { Readable } from 'node:stream';

import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentResult, AgentTask, AgentTokenUsage } from '@ai-dev-orchestrator/schemas';

import type { readCliOutput } from './cli-output-reader';
import { extractUsageFromRawLine } from './cli-token-usage';

/** Read legacy stdout/usage after negotiation; subprocess ownership stays with the caller. */
export async function runLegacyMode(
  task: AgentTask,
  readOutput: typeof readCliOutput,
  subprocess: PromiseLike<unknown> & {
    readonly stdout?: Readable | null;
    readonly stderr?: Readable | null;
  },
  startTime: number,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  earlyError?: unknown,
  initialUsage?: { input: number; output: number },
): Promise<AgentResult> {
  if (earlyError) {
    // Process already exited with error during handshake negotiation
    if (earlyError instanceof Error) {
      throw earlyError;
    }
    const message = typeof earlyError === 'string' ? earlyError : 'Unknown process error';
    throw new Error(message);
  }

  let highWaterInput = initialUsage?.input ?? 0;
  let highWaterOutput = initialUsage?.output ?? 0;
  let deltaInput = 0;
  let deltaOutput = 0;
  let legacyFinalUsage: AgentTokenUsage | undefined;
  const getLegacyUsage = (): AgentTokenUsage | undefined => {
    if (legacyFinalUsage) {
      return legacyFinalUsage;
    }
    const input = Math.max(highWaterInput, deltaInput);
    const output = Math.max(highWaterOutput, deltaOutput);
    return input > 0 || output > 0 ? { inputTokens: input, outputTokens: output } : undefined;
  };
  let lineBuffer = '';

  subprocess.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();

    const combined = lineBuffer + text;
    const segments = combined.split('\n');
    lineBuffer = segments.pop() ?? '';
    for (const segment of segments) {
      const usage = extractUsageFromRawLine(segment);
      if (usage) {
        if (usage.isFinal) {
          legacyFinalUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        } else if (usage.cumulative) {
          highWaterInput = Math.max(highWaterInput, usage.inputTokens);
          highWaterOutput = Math.max(highWaterOutput, usage.outputTokens);
        } else {
          deltaInput += usage.inputTokens;
          deltaOutput += usage.outputTokens;
        }
        const current = getLegacyUsage();
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'status',
          content: '',
          structuredData: {
            phase: 'usage_update',
            inputTokens: current?.inputTokens ?? 0,
            outputTokens: current?.outputTokens ?? 0,
          },
        });
      }
    }

    onStreamEvent?.({
      timestamp: new Date().toISOString(),
      type: 'stdout',
      content: text,
    });
  });

  if (onStreamEvent) {
    subprocess.stderr?.on('data', (chunk: Buffer) => {
      onStreamEvent({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        content: chunk.toString(),
      });
    });
  }

  await subprocess;

  if (lineBuffer.length > 0) {
    const usage = extractUsageFromRawLine(lineBuffer);
    if (usage) {
      if (usage.isFinal) {
        legacyFinalUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      } else if (usage.cumulative) {
        highWaterInput = Math.max(highWaterInput, usage.inputTokens);
        highWaterOutput = Math.max(highWaterOutput, usage.outputTokens);
      } else {
        deltaInput += usage.inputTokens;
        deltaOutput += usage.outputTokens;
      }
    }
  }

  return readOutput(task, startTime, getLegacyUsage(), onStreamEvent);
}
