import type { ArtifactRef } from '@ai-orchestrator/schemas';

import type { DashboardAgentStreamEvent, DispatchGroup } from '../../hooks/use-agent-stream';
import { formatTokens } from '../../lib/format';
import { formatArtifactDisplayName, humanize } from '../../lib/humanize';

export const ACTION_LABELS: Record<string, string> = {
  file_write: 'Write File',
  file_read: 'Read File',
  shell_execute: 'Run Command',
  network: 'Network Access',
  custom: 'Tool Call',
};

export function isToolCallNoise(line: DashboardAgentStreamEvent): boolean {
  const phase = line.structuredData?.['phase'];
  const messageType = line.structuredData?.['messageType'];
  return (
    phase === 'tool_call' ||
    phase === 'tool_result' ||
    phase === 'init' ||
    phase === 'usage_update' ||
    phase === 'artifact_produced' ||
    messageType === 'artifact_produced' ||
    messageType === 'cli_prompt'
  );
}

export function isStderrWarning(line: DashboardAgentStreamEvent): boolean {
  if (line.type !== 'stderr') {
    return false;
  }
  const lower = line.content.toLowerCase();
  return lower.includes('warn') || lower.includes('not available') || lower.includes('no stdin');
}

export function formatArtifactLabel(ref: ArtifactRef): string {
  return formatArtifactDisplayName(ref);
}

export interface LineTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export function extractUsageUpdate(line: DashboardAgentStreamEvent): LineTokenUsage | undefined {
  if (line.structuredData?.['phase'] !== 'usage_update') {
    return undefined;
  }
  return {
    inputTokens: Number(line.structuredData['inputTokens']) || 0,
    outputTokens: Number(line.structuredData['outputTokens']) || 0,
  };
}

export function buildLineUsageMap(
  allLines: readonly DashboardAgentStreamEvent[],
): Map<DashboardAgentStreamEvent, LineTokenUsage> {
  const map = new Map<DashboardAgentStreamEvent, LineTokenUsage>();
  const lastUsageByKey = new Map<string, LineTokenUsage>();

  const usageKey = (line: DashboardAgentStreamEvent): string =>
    `${line.roleId}\0${line.dispatchId}`;

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const key = usageKey(line);
    const update = extractUsageUpdate(line);
    if (update) {
      lastUsageByKey.set(key, update);
      continue;
    }

    let usage = lastUsageByKey.get(key);
    for (let j = i + 1; j < allLines.length; j++) {
      const next = allLines[j];
      if (usageKey(next) !== key) {
        continue;
      }
      const ahead = extractUsageUpdate(next);
      if (ahead) {
        usage = ahead;
        continue;
      }
      break;
    }
    if (usage) {
      lastUsageByKey.set(key, usage);
      map.set(line, usage);
    }
  }

  return map;
}

export function latestUsageForLines(
  lines: readonly DashboardAgentStreamEvent[],
  usageMap: ReadonlyMap<DashboardAgentStreamEvent, LineTokenUsage>,
): LineTokenUsage | undefined {
  let latest: LineTokenUsage | undefined;
  for (const line of lines) {
    const usage = usageMap.get(line);
    if (usage) {
      latest = usage;
    }
  }
  return latest;
}

export function deduplicateRefs(refs: readonly ArtifactRef[]): ArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.name}:v${String(ref.version)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

export function humanizeRole(roleId: string): string {
  return humanize(roleId);
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export type MessageSender = 'orchestrator' | 'agent' | 'system' | 'human';

export function classifySender(line: DashboardAgentStreamEvent): MessageSender {
  const mt = line.protocolMessage?.messageType;
  if (
    mt === 'task_prompt' ||
    line.roleId === 'orchestrator' ||
    line.structuredData?.['sender'] === 'orchestrator'
  ) {
    return 'orchestrator';
  }
  if (line.roleId === 'human') {
    return 'human';
  }
  if (
    mt === 'permission_request' ||
    mt === 'permission_response' ||
    mt === 'permission_resolved' ||
    mt === 'clarification_request' ||
    mt === 'clarification_response'
  ) {
    return 'system';
  }
  return 'agent';
}

export function senderLabel(line: DashboardAgentStreamEvent): string {
  const sender = classifySender(line);
  if (sender === 'orchestrator') {
    return 'AI Dev Orchestrator';
  }
  if (sender === 'human') {
    return 'Human';
  }
  if (sender === 'system') {
    return 'System';
  }
  return humanizeRole(line.roleId);
}

export interface MessageGroup {
  readonly sender: MessageSender;
  readonly senderLabel: string;
  readonly stateId?: string;
  readonly lines: readonly DashboardAgentStreamEvent[];
}

export function flushGroup(
  current: {
    sender: MessageSender;
    label: string;
    stateId?: string;
    lines: DashboardAgentStreamEvent[];
  } | null,
): MessageGroup | undefined {
  if (!current) {
    return undefined;
  }
  return {
    sender: current.sender,
    senderLabel: current.label,
    stateId: current.stateId,
    lines: current.lines,
  };
}

export function groupMessages(
  lines: readonly DashboardAgentStreamEvent[],
): readonly MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: {
    sender: MessageSender;
    label: string;
    dispatchId?: string;
    stateId?: string;
    lines: DashboardAgentStreamEvent[];
  } | null = null;

  for (const line of lines) {
    const sender = classifySender(line);
    const label = senderLabel(line);

    if (sender === 'system') {
      const flushed = flushGroup(current);
      if (flushed) {
        groups.push(flushed);
      }
      current = null;
      groups.push({ sender, senderLabel: label, stateId: line.stateId, lines: [line] });
    } else if (
      current &&
      current.sender === sender &&
      current.label === label &&
      current.dispatchId === line.dispatchId
    ) {
      current.lines.push(line);
      if (!current.stateId && line.stateId) {
        current.stateId = line.stateId;
      }
    } else {
      const flushed = flushGroup(current);
      if (flushed) {
        groups.push(flushed);
      }
      current = {
        sender,
        label,
        dispatchId: line.dispatchId,
        stateId: line.stateId,
        lines: [line],
      };
    }
  }

  const flushed = flushGroup(current);
  if (flushed) {
    groups.push(flushed);
  }

  return groups;
}

export const senderBorderColor: Record<MessageSender, string> = {
  orchestrator: 'border-emerald-500',
  agent: 'border-cyan-400',
  human: 'border-rose-400',
  system: 'border-slate-600',
};

export const senderLabelColor: Record<MessageSender, string> = {
  orchestrator: 'text-emerald-400',
  agent: 'text-cyan-400',
  human: 'text-rose-400',
  system: 'text-slate-500',
};

export interface RoleMeta {
  readonly model?: string;
  readonly runner?: string;
}

export function buildRoleMetaMap(
  allLines: readonly DashboardAgentStreamEvent[],
): Map<string, RoleMeta> {
  const byRole = new Map<string, RoleMeta>();
  for (const line of allLines) {
    const isTaskPrompt =
      line.protocolMessage?.messageType === 'task_prompt' ||
      line.structuredData?.['messageType'] === 'task_prompt';
    if (!isTaskPrompt) {
      continue;
    }
    const payload = line.protocolMessage?.payload ?? line.structuredData ?? {};
    const role = str(payload['role']) || line.roleId;
    if (!role || role === 'orchestrator' || role === 'human') {
      continue;
    }
    const model = str(payload['model']);
    const runner = str(payload['runner']) || str(line.structuredData?.['runner']);
    byRole.set(role, {
      model: model && model !== 'agent' ? model : undefined,
      runner: runner || undefined,
    });
  }
  return byRole;
}

export function buildDispatchPromptMap(
  allLines: readonly DashboardAgentStreamEvent[],
): Map<string, string> {
  const byDispatch = new Map<string, string>();
  for (const line of allLines) {
    const msgType =
      line.protocolMessage?.messageType ??
      (line.structuredData?.['messageType'] as string | undefined);

    if (msgType === 'task_prompt' && line.dispatchId) {
      const payload = line.protocolMessage?.payload ?? line.structuredData ?? {};
      const prompt = str(payload['rolePrompt']);
      if (prompt) {
        byDispatch.set(line.dispatchId, prompt);
      }
    }

    if (msgType === 'cli_prompt' && line.dispatchId) {
      const payload = line.protocolMessage?.payload ?? line.structuredData ?? {};
      const cliPrompt = str(payload['cliPrompt']);
      if (cliPrompt) {
        byDispatch.set(line.dispatchId, cliPrompt);
      }
    }
  }
  return byDispatch;
}

export function buildDispatchDescriptionMap(
  allLines: readonly DashboardAgentStreamEvent[],
): Map<string, string> {
  const byDispatch = new Map<string, string>();
  for (const line of allLines) {
    const msgType =
      line.protocolMessage?.messageType ??
      (line.structuredData?.['messageType'] as string | undefined);

    if (msgType === 'task_prompt' && line.dispatchId) {
      const payload = line.protocolMessage?.payload ?? line.structuredData ?? {};
      const desc = str(payload['description']);
      if (desc) {
        byDispatch.set(line.dispatchId, desc);
      }
    }
  }
  return byDispatch;
}

export function mergeAllLines(
  groups: Map<string, DispatchGroup>,
): readonly DashboardAgentStreamEvent[] {
  const all: DashboardAgentStreamEvent[] = [];
  for (const group of groups.values()) {
    all.push(...group.lines);
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return all;
}

export const logLevelStyles: Record<string, string> = {
  debug: 'text-muted-foreground/60',
  info: 'text-foreground/80',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

export const logLevelIcons: Record<string, string> = {
  warn: '⚠',
  error: '✗',
};

export { formatTokens };
