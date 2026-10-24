import type { VendorTokenUsage } from '@ai-dev-orchestrator/agent-adapters';
import {
  parseClaudeCodeEvent,
  parseCodexEvent,
  parseOpenCodeEvent,
} from '@ai-dev-orchestrator/agent-adapters';

export function extractArtifactTokenUsage(
  raw: unknown,
): { inputTokens: number; outputTokens: number } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const inputTokens =
    'inputTokens' in raw && typeof raw.inputTokens === 'number' ? raw.inputTokens : 0;
  const outputTokens =
    'outputTokens' in raw && typeof raw.outputTokens === 'number' ? raw.outputTokens : 0;
  return inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined;
}

function parseVendorUsage(u: VendorTokenUsage): {
  inputTokens: number;
  outputTokens: number;
} {
  const num = (v: number | undefined): number => v ?? 0;

  if (isOpenCodeUsageShape(u)) {
    return {
      inputTokens: num(u.input) + num(u.cache?.read),
      outputTokens: num(u.output) + num(u.reasoning),
    };
  }

  if (isCodexUsageShape(u)) {
    // Codex reports cached_input_tokens as a subset of input_tokens — do not add them.
    return {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens) + num(u.reasoning_output_tokens),
    };
  }

  const anthropicInput =
    num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
  const anthropicOutput = num(u.output_tokens);
  const cursorInput = num(u.inputTokens);
  const cursorOutput = num(u.outputTokens);
  return {
    inputTokens: Math.max(anthropicInput, cursorInput),
    outputTokens: Math.max(anthropicOutput, cursorOutput),
  };
}

function isOpenCodeUsageShape(usage: VendorTokenUsage): boolean {
  return (
    ('cache' in usage && typeof (usage as Record<string, unknown>).cache === 'object') ||
    ('reasoning' in usage && typeof (usage as Record<string, unknown>).reasoning === 'number')
  );
}

function isCodexUsageShape(usage: VendorTokenUsage): boolean {
  return 'cached_input_tokens' in usage || 'reasoning_output_tokens' in usage;
}

export interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  isFinal?: boolean;
  cumulative?: boolean;
}

function isAnthropicUsageShape(usage: Record<string, unknown>): boolean {
  return 'input_tokens' in usage || 'cache_read_input_tokens' in usage;
}

export function extractUsageFromRawLine(line: string): ExtractedUsage | null {
  // Claude and Cursor share assistant/result envelopes; usage keys distinguish their accounting.
  const claudeEvent = parseClaudeCodeEvent(line);
  if (claudeEvent) {
    if (claudeEvent.type === 'result' && claudeEvent.usage) {
      return { ...parseVendorUsage(claudeEvent.usage), isFinal: true };
    }
    if (claudeEvent.type === 'assistant' && claudeEvent.message?.usage) {
      const usage = claudeEvent.message.usage as Record<string, unknown>;
      const cumulative = isAnthropicUsageShape(usage);
      return { ...parseVendorUsage(claudeEvent.message.usage), ...(cumulative && { cumulative }) };
    }
  }

  const codexEvent = parseCodexEvent(line);
  if (codexEvent?.type === 'turn.completed' && codexEvent.usage) {
    return { ...parseVendorUsage(codexEvent.usage), isFinal: true };
  }

  const opencodeEvent = parseOpenCodeEvent(line);
  if (opencodeEvent?.type === 'step_finish' && opencodeEvent.part?.tokens) {
    return parseVendorUsage(opencodeEvent.part.tokens);
  }

  return null;
}
