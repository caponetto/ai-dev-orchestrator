import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PermissionRequestPayload } from '@ai-dev-orchestrator/agent-protocol';
import { payloadToRecord } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentStreamEvent, PermissionPolicyConfig } from '@ai-dev-orchestrator/ports';
import type { AgentTask, RoleId, ThreeTierSeverity } from '@ai-dev-orchestrator/schemas';
import { livePermissionResponsePayloadSchema } from '@ai-dev-orchestrator/schemas';

import { DefaultPermissionPolicy } from './default-permission-policy';
import {
  agentStreamEventSchema,
  appendAgentStreamEventToRunFile,
} from './file-backed-agent-stream-bus';
import { FileBackedLiveRequestStore } from './file-backed-live-request-store';
import { FileBackedPermissionApprovalStore } from './permission-approval-store';

export const CODEX_HOOK_CONTEXT_ENV = 'AI_ORCHESTRATOR_CODEX_HOOK_CONTEXT';
export const CODEX_HOOK_CONTEXT_FILENAME = 'codex-permission-hook-context.json';
export const CODEX_HOOK_SCRIPT_FILENAME = 'codex-permission-hook.sh';

const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 300_000;
const CODEX_HOOK_TIMEOUT_SECONDS = 600;

export interface CodexPermissionHookInput {
  readonly session_id?: string;
  readonly turn_id?: string;
  readonly cwd?: string;
  readonly hook_event_name?: string;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
}

interface CodexPermissionHookContext {
  readonly runId: string;
  readonly stateId: string;
  readonly role: RoleId;
  readonly repoRoot: string;
  readonly runDir: string;
  readonly runsDir: string;
  readonly dispatchId: string;
  readonly liveRequestTimeoutMs: number;
  readonly permissionPolicyConfig?: PermissionPolicyConfig;
  readonly approvalStorePath?: string;
  readonly cliEntryPath: string;
  readonly nodeExecutable: string;
}

export interface CodexPermissionBridgeConfig {
  readonly runsDir: string;
  readonly cliEntryPath: string;
  readonly nodeExecutable?: string;
}

export function mapCodexHookInputToPermissionRequest(
  input: CodexPermissionHookInput,
): PermissionRequestPayload {
  const toolName = input.tool_name ?? 'unknown';
  const toolInput = input.tool_input ?? {};
  const resource = extractResource(toolInput);
  const description =
    typeof toolInput['description'] === 'string' ? toolInput['description'] : undefined;
  const detail = buildPermissionDetail(toolName, toolInput, description);

  return {
    action: categorizeAction(toolName),
    resource,
    detail,
    riskLevel: categorizeRisk(toolName),
    externalRequestId: input.turn_id,
    toolInput,
  };
}

export function buildCodexPermissionHookAllowResponse(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  });
}

function buildCodexPermissionHookDenyResponse(message: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message },
    },
  });
}

/** Build a Codex `-c` override that registers a PermissionRequest hook command. */
export function buildCodexPermissionHookConfigArg(
  hookCommand: string,
  timeoutSeconds = CODEX_HOOK_TIMEOUT_SECONDS,
): string {
  const escapedCommand = hookCommand.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `hooks.PermissionRequest=[{matcher=".*",hooks=[{type="command",command="${escapedCommand}",timeout=${String(timeoutSeconds)}}]}]`;
}

export function buildCodexPermissionHookArgs(
  hookCommand: string,
  timeoutSeconds = CODEX_HOOK_TIMEOUT_SECONDS,
): string[] {
  return [
    '--dangerously-bypass-hook-trust',
    '-c',
    buildCodexPermissionHookConfigArg(hookCommand, timeoutSeconds),
  ];
}

export async function writeCodexPermissionHookArtifacts(
  task: AgentTask,
  bridge: CodexPermissionBridgeConfig,
  permissionPolicyConfig?: PermissionPolicyConfig,
  approvalStorePath?: string,
  liveRequestTimeoutMs?: number,
): Promise<{ hookCommand: string; contextPath: string }> {
  const contextPath = join(task.runDir, CODEX_HOOK_CONTEXT_FILENAME);
  const hookScriptPath = join(task.runDir, CODEX_HOOK_SCRIPT_FILENAME);
  const nodeExecutable = bridge.nodeExecutable ?? process.execPath;

  const context: CodexPermissionHookContext = {
    runId: task.runId,
    stateId: task.stateId,
    role: task.role,
    repoRoot: task.repoRoot,
    runDir: task.runDir,
    runsDir: bridge.runsDir,
    dispatchId: `codex-${task.taskId}`,
    liveRequestTimeoutMs:
      task.agentConfig?.['liveRequestTimeoutMs'] ??
      liveRequestTimeoutMs ??
      DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
    permissionPolicyConfig,
    approvalStorePath,
    cliEntryPath: bridge.cliEntryPath,
    nodeExecutable,
  };

  await mkdir(task.runDir, { recursive: true });
  await writeFile(contextPath, JSON.stringify(context, null, 2));

  const script = [
    '#!/bin/sh',
    `export ${CODEX_HOOK_CONTEXT_ENV}=${JSON.stringify(contextPath)}`,
    `exec ${JSON.stringify(nodeExecutable)} ${JSON.stringify(bridge.cliEntryPath)} codex-permission-hook`,
    '',
  ].join('\n');
  await writeFile(hookScriptPath, script, { mode: 0o755 });
  await chmod(hookScriptPath, 0o755);

  return { hookCommand: hookScriptPath, contextPath };
}

export async function handleCodexPermissionHook(
  contextPath: string,
  stdinJson?: string,
): Promise<string> {
  const stdin = stdinJson ?? (await readStdin());
  let hookInput: CodexPermissionHookInput;
  try {
    hookInput = JSON.parse(stdin) as CodexPermissionHookInput;
  } catch {
    return buildCodexPermissionHookDenyResponse('Invalid Codex permission hook input');
  }

  const context = await readCodexPermissionHookContext(contextPath);
  const payload = mapCodexHookInputToPermissionRequest(hookInput);
  const messageId = randomUUID();

  const approvalStore = context.approvalStorePath
    ? new FileBackedPermissionApprovalStore(context.approvalStorePath)
    : undefined;
  if (approvalStore) {
    await approvalStore.reload();
  }

  const policy = new DefaultPermissionPolicy(context.permissionPolicyConfig, approvalStore);
  const decision = policy.evaluate(payload, {
    role: context.role,
    runId: context.runId,
    stateId: context.stateId,
    repoRoot: context.repoRoot,
  });

  if (decision.action === 'grant') {
    appendPermissionStreamEvent(context, messageId, payload, {
      messageType: 'permission_resolved',
      resolved: 'granted',
      reason: decision.reason,
    });
    return buildCodexPermissionHookAllowResponse();
  }

  if (decision.action === 'deny') {
    appendPermissionStreamEvent(context, messageId, payload, {
      messageType: 'permission_resolved',
      resolved: 'denied',
      reason: decision.reason,
    });
    return buildCodexPermissionHookDenyResponse(decision.reason ?? 'Permission denied');
  }

  appendPermissionStreamEvent(context, messageId, payload, {
    messageType: 'permission_request',
    ...payloadToRecord(payload),
  });

  const liveRequestStore = new FileBackedLiveRequestStore(context.runsDir);
  const now = new Date();
  await liveRequestStore.writeRequest({
    runId: context.runId,
    messageId,
    kind: 'permission',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + context.liveRequestTimeoutMs).toISOString(),
    payload: payloadToRecord(payload),
  });

  const response = await liveRequestStore.awaitResponse(
    context.runId,
    messageId,
    context.liveRequestTimeoutMs,
  );

  if (!response) {
    await liveRequestStore.writeResponse({
      runId: context.runId,
      messageId,
      respondedAt: new Date().toISOString(),
      payload: { timedOut: true, granted: false },
    });
    appendPermissionStreamEvent(context, messageId, payload, {
      messageType: 'permission_resolved',
      resolved: 'denied',
      reason: 'Permission request timed out',
      timedOut: true,
    });
    return buildCodexPermissionHookDenyResponse('Permission request timed out');
  }

  const permPayload = livePermissionResponsePayloadSchema.safeParse(response.payload);
  const granted = permPayload.success && permPayload.data.granted === true;
  const reason = permPayload.success ? permPayload.data.reason : undefined;

  appendPermissionStreamEvent(context, messageId, payload, {
    messageType: granted ? 'permission_response' : 'permission_resolved',
    granted,
    reason,
    resolved: granted ? 'granted' : 'denied',
    action: payload.action,
  });

  if (granted) {
    if (approvalStore) {
      await approvalStore.record({
        action: payload.action,
        resource: payload.resource,
        detail: payload.detail,
        createdByRole: context.role,
      });
    }
    return buildCodexPermissionHookAllowResponse();
  }

  return buildCodexPermissionHookDenyResponse(reason ?? 'Permission denied');
}

async function readCodexPermissionHookContext(
  contextPath: string,
): Promise<CodexPermissionHookContext> {
  const content = await readFile(contextPath, 'utf-8');
  return JSON.parse(content) as CodexPermissionHookContext;
}

function appendPermissionStreamEvent(
  context: CodexPermissionHookContext,
  messageId: string,
  payload: PermissionRequestPayload,
  structuredData: Record<string, unknown>,
): void {
  const mergedStructuredData = {
    ...payloadToRecord(payload),
    ...structuredData,
  };

  const granted = mergedStructuredData['granted'];
  const resolved = mergedStructuredData['resolved'];
  const isPending = mergedStructuredData['messageType'] === 'permission_request';

  const event: AgentStreamEvent = {
    runId: context.runId,
    stateId: context.stateId,
    roleId: context.role,
    dispatchId: context.dispatchId,
    timestamp: new Date().toISOString(),
    type: 'permission_request',
    content: isPending
      ? `Permission request: ${payload.action} ${payload.resource} (${payload.riskLevel} risk)`
      : `Permission ${resolved === 'granted' || granted === true ? 'granted' : 'denied'}: ${payload.action} ${payload.resource}`,
    structuredData: mergedStructuredData,
    requestMessageId: messageId,
  };

  const parsed = agentStreamEventSchema.safeParse(event);
  if (!parsed.success) {
    return;
  }

  appendAgentStreamEventToRunFile(parsed.data, context.runsDir);
}

function extractResource(toolInput: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'file', 'url', 'directory']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return '';
}

function buildPermissionDetail(
  toolName: string,
  toolInput: Record<string, unknown>,
  description?: string,
): string {
  const resource = extractResource(toolInput);
  if (description && description.length > 0) {
    return `${toolName}: ${description}`;
  }
  if (resource) {
    return `${toolName}: ${resource}`;
  }
  return toolName;
}

function categorizeRisk(tool: string): ThreeTierSeverity {
  const lower = tool.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec')) {
    return 'high';
  }
  if (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('delete') ||
    lower.includes('apply_patch')
  ) {
    return 'medium';
  }
  return 'low';
}

function categorizeAction(tool: string): PermissionRequestPayload['action'] {
  const lower = tool.toLowerCase();
  if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) {
    return 'file_read';
  }
  if (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('create') ||
    lower.includes('apply_patch')
  ) {
    return 'file_write';
  }
  if (lower.includes('delete') || lower.includes('rm') || lower.includes('remove')) {
    return 'file_delete';
  }
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec')) {
    return 'shell_execute';
  }
  if (lower.includes('fetch') || lower.includes('curl') || lower.includes('http')) {
    return 'network_request';
  }
  if (lower.includes('git')) {
    return 'git_operation';
  }
  return 'custom';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
