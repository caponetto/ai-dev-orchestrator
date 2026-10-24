import { readFile } from 'node:fs/promises';

import type { AgentOutputStreamEvent } from '@ai-dev-orchestrator/ports';
import type { AgentTask, AgentResult, AgentTokenUsage } from '@ai-dev-orchestrator/schemas';

import { extractArtifactTokenUsage } from './cli-token-usage';

export async function readCliOutput(
  task: AgentTask,
  startTime: number,
  preAccumulatedUsage?: AgentTokenUsage,
  onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  fallbackContent?: string,
): Promise<AgentResult> {
  const durationMs = Date.now() - startTime;
  const maxAttempts = 4;
  const retryDelayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const content = await readFile(task.outputArtifactPath, 'utf-8');
      const parsed = parseJsonContent(content);

      const artifactUsage = extractArtifactTokenUsage(parsed['tokenUsage']);
      const hasArtifactUsage =
        artifactUsage && (artifactUsage.inputTokens > 0 || artifactUsage.outputTokens > 0);

      return {
        taskId: task.taskId,
        status: 'success',
        artifactContent: content,
        durationMs,
        tokenUsage: hasArtifactUsage ? artifactUsage : (preAccumulatedUsage ?? artifactUsage),
      };
    } catch {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
    }
  }

  if (fallbackContent) {
    try {
      const parsed = parseJsonContent(fallbackContent);
      const artifactUsage = extractArtifactTokenUsage(parsed['tokenUsage']);
      const hasArtifactUsage =
        artifactUsage && (artifactUsage.inputTokens > 0 || artifactUsage.outputTokens > 0);

      return {
        taskId: task.taskId,
        status: 'success',
        artifactContent: fallbackContent,
        durationMs,
        tokenUsage: hasArtifactUsage ? artifactUsage : preAccumulatedUsage,
      };
    } catch {
      // Fall through to failure below.
    }
  }

  const errorMsg = `Failed to read agent output artifact — the agent process exited without producing the expected output file at ${task.outputArtifactPath}`;
  onStreamEvent?.({
    timestamp: new Date().toISOString(),
    type: 'stderr',
    content: errorMsg,
    structuredData: {
      messageType: 'error',
      phase: 'error',
      code: 'missing_output_artifact',
      sender: 'orchestrator',
    },
  });
  return {
    taskId: task.taskId,
    status: 'failure',
    error: errorMsg,
    durationMs,
    tokenUsage: preAccumulatedUsage,
  };
}

/**
 * When an agent emits the final JSON artifact in a message instead of the output file,
 * use it as a last-resort fallback after file reads are exhausted.
 */
export function extractArtifactJsonFromAgentText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Parses JSON content that may contain multiple concatenated JSON objects
 * (a known issue with some agent runners that append instead of overwrite).
 * Falls back to extracting the last valid top-level JSON object.
 */
function parseJsonContent(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const lastBrace = content.lastIndexOf('\n{');
    if (lastBrace > 0) {
      const lastObject = content.slice(lastBrace + 1);
      return JSON.parse(lastObject) as Record<string, unknown>;
    }
    throw new Error('Invalid JSON in artifact file');
  }
}
