import type { ArtifactRef } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent, DispatchGroup } from '../../../hooks/use-agent-stream';
import type { LineTokenUsage, MessageSender } from '../output-utils';
import {
  ACTION_LABELS,
  buildDispatchDescriptionMap,
  buildDispatchPromptMap,
  buildLineUsageMap,
  buildRoleMetaMap,
  classifySender,
  deduplicateRefs,
  extractUsageUpdate,
  flushGroup,
  formatArtifactLabel,
  formatTime,
  groupMessages,
  humanizeRole,
  isStderrWarning,
  isToolCallNoise,
  latestUsageForLines,
  logLevelIcons,
  logLevelStyles,
  mergeAllLines,
  senderBorderColor,
  senderLabel,
  senderLabelColor,
  str,
} from '../output-utils';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeLine(overrides: Partial<DashboardAgentStreamEvent> = {}): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    stateId: 'state-1',
    roleId: 'developer',
    dispatchId: 'dispatch-1',
    timestamp: '2026-01-15T10:00:00Z',
    type: 'stdout',
    content: '',
    ...overrides,
  };
}

function makeRef(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    type: 'canonical_specification',
    name: 'main',
    version: 1,
    checksum: 'abc123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ACTION_LABELS (exported constant)
// ---------------------------------------------------------------------------

describe('ACTION_LABELS', () => {
  it('contains expected action keys', () => {
    expect(ACTION_LABELS['file_write']).toBe('Write File');
    expect(ACTION_LABELS['file_read']).toBe('Read File');
    expect(ACTION_LABELS['shell_execute']).toBe('Run Command');
    expect(ACTION_LABELS['network']).toBe('Network Access');
    expect(ACTION_LABELS['custom']).toBe('Tool Call');
  });
});

// ---------------------------------------------------------------------------
// isStderrWarning
// ---------------------------------------------------------------------------

describe('isStderrWarning', () => {
  it('returns false for stdout lines', () => {
    const line = makeLine({ type: 'stdout', content: 'Warning: something' });
    expect(isStderrWarning(line)).toBe(false);
  });

  it('returns true for stderr containing "warn"', () => {
    const line = makeLine({ type: 'stderr', content: 'Warning: model not found' });
    expect(isStderrWarning(line)).toBe(true);
  });

  it('returns true for stderr containing "not available"', () => {
    const line = makeLine({ type: 'stderr', content: 'Opus 5 not available — using fallback' });
    expect(isStderrWarning(line)).toBe(true);
  });

  it('returns true for stderr containing "no stdin"', () => {
    const line = makeLine({ type: 'stderr', content: 'no stdin detected' });
    expect(isStderrWarning(line)).toBe(true);
  });

  it('returns false for stderr errors', () => {
    const line = makeLine({ type: 'stderr', content: 'Error: file not found' });
    expect(isStderrWarning(line)).toBe(false);
  });

  it('is case-insensitive', () => {
    const line = makeLine({ type: 'stderr', content: 'WARNING: something' });
    expect(isStderrWarning(line)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isToolCallNoise
// ---------------------------------------------------------------------------

describe('isToolCallNoise', () => {
  it('returns true when phase is tool_call', () => {
    const line = makeLine({ structuredData: { phase: 'tool_call' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when phase is tool_result', () => {
    const line = makeLine({ structuredData: { phase: 'tool_result' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when phase is init', () => {
    const line = makeLine({ structuredData: { phase: 'init' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when phase is usage_update', () => {
    const line = makeLine({ structuredData: { phase: 'usage_update' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when phase is artifact_produced', () => {
    const line = makeLine({ structuredData: { phase: 'artifact_produced' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when messageType is artifact_produced', () => {
    const line = makeLine({ structuredData: { messageType: 'artifact_produced' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns true when messageType is cli_prompt', () => {
    const line = makeLine({ structuredData: { messageType: 'cli_prompt' } });
    expect(isToolCallNoise(line)).toBe(true);
  });

  it('returns false when phase and messageType are not noise values', () => {
    const line = makeLine({ structuredData: { phase: 'output', messageType: 'progress' } });
    expect(isToolCallNoise(line)).toBe(false);
  });

  it('returns false when structuredData is undefined', () => {
    const line = makeLine({ structuredData: undefined });
    expect(isToolCallNoise(line)).toBe(false);
  });

  it('returns false when structuredData has no phase or messageType', () => {
    const line = makeLine({ structuredData: {} });
    expect(isToolCallNoise(line)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatArtifactLabel
// ---------------------------------------------------------------------------

describe('formatArtifactLabel', () => {
  it('formats an artifact ref using humanized type and version', () => {
    const ref = makeRef({ type: 'canonical_specification', version: 3 });
    expect(formatArtifactLabel(ref)).toBe('Canonical Specification v3');
  });

  it('handles multi-word artifact types', () => {
    const ref = makeRef({ type: 'review_report', version: 1 });
    expect(formatArtifactLabel(ref)).toBe('Review Report v1');
  });
});

// ---------------------------------------------------------------------------
// extractUsageUpdate
// ---------------------------------------------------------------------------

describe('extractUsageUpdate', () => {
  it('returns usage when phase is usage_update', () => {
    const line = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 100, outputTokens: 50 },
    });
    const result = extractUsageUpdate(line);
    expect(result).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('returns undefined when phase is not usage_update', () => {
    const line = makeLine({ structuredData: { phase: 'output' } });
    expect(extractUsageUpdate(line)).toBeUndefined();
  });

  it('returns undefined when structuredData is undefined', () => {
    const line = makeLine({ structuredData: undefined });
    expect(extractUsageUpdate(line)).toBeUndefined();
  });

  it('coerces string token values to numbers', () => {
    const line = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: '200', outputTokens: '75' },
    });
    const result = extractUsageUpdate(line);
    expect(result).toEqual({ inputTokens: 200, outputTokens: 75 });
  });

  it('defaults NaN token values to 0', () => {
    const line = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 'bad', outputTokens: undefined },
    });
    const result = extractUsageUpdate(line);
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('defaults missing token fields to 0', () => {
    const line = makeLine({
      structuredData: { phase: 'usage_update' },
    });
    const result = extractUsageUpdate(line);
    expect(result).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildLineUsageMap
// ---------------------------------------------------------------------------

describe('buildLineUsageMap', () => {
  it('returns empty map for empty input', () => {
    const map = buildLineUsageMap([]);
    expect(map.size).toBe(0);
  });

  it('maps non-usage lines to their nearest forward usage update', () => {
    const contentLine = makeLine({ content: 'hello' });
    const usageLine = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const map = buildLineUsageMap([contentLine, usageLine]);
    expect(map.get(contentLine)).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(map.has(usageLine)).toBe(false);
  });

  it('uses last prior usage when no forward usage exists', () => {
    const usageLine = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const contentLine = makeLine({ content: 'after usage' });
    const map = buildLineUsageMap([usageLine, contentLine]);
    expect(map.get(contentLine)).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('isolates usage by roleId and dispatchId key', () => {
    const lineA = makeLine({ roleId: 'dev', dispatchId: 'd1', content: 'a' });
    const usageA = makeLine({
      roleId: 'dev',
      dispatchId: 'd1',
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const lineB = makeLine({ roleId: 'reviewer', dispatchId: 'd2', content: 'b' });
    const usageB = makeLine({
      roleId: 'reviewer',
      dispatchId: 'd2',
      structuredData: { phase: 'usage_update', inputTokens: 20, outputTokens: 15 },
    });
    const map = buildLineUsageMap([lineA, usageA, lineB, usageB]);
    expect(map.get(lineA)).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(map.get(lineB)).toEqual({ inputTokens: 20, outputTokens: 15 });
  });

  it('does not include usage lines themselves in the output map', () => {
    const usageLine = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const map = buildLineUsageMap([usageLine]);
    expect(map.size).toBe(0);
  });

  it('picks the closest forward usage when multiple exist for the same key', () => {
    const content = makeLine({ content: 'work' });
    const usage1 = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const usage2 = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 99, outputTokens: 88 },
    });
    // The look-ahead finds usage1 first, then continues to usage2 but then hits a non-usage
    // line of the same key and breaks, so usage2 is the latest one found
    const map = buildLineUsageMap([content, usage1, usage2]);
    // usage2 is the last usage_update before hitting a non-usage line or end
    expect(map.get(content)).toEqual({ inputTokens: 99, outputTokens: 88 });
  });

  it('breaks look-ahead on first non-usage line of the same key', () => {
    const content1 = makeLine({ content: 'first' });
    const usage1 = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 10, outputTokens: 5 },
    });
    const content2 = makeLine({ content: 'second' });
    const usage2 = makeLine({
      structuredData: { phase: 'usage_update', inputTokens: 99, outputTokens: 88 },
    });
    const map = buildLineUsageMap([content1, usage1, content2, usage2]);
    // content1 look-ahead: finds usage1, then content2 matches same key -> break
    expect(map.get(content1)).toEqual({ inputTokens: 10, outputTokens: 5 });
    // content2 look-ahead: finds usage2
    expect(map.get(content2)).toEqual({ inputTokens: 99, outputTokens: 88 });
  });

  it('skips lines with different keys during look-ahead', () => {
    const content = makeLine({ roleId: 'dev', dispatchId: 'd1', content: 'work' });
    const otherKeyLine = makeLine({
      roleId: 'reviewer',
      dispatchId: 'd2',
      content: 'review',
    });
    const usage = makeLine({
      roleId: 'dev',
      dispatchId: 'd1',
      structuredData: { phase: 'usage_update', inputTokens: 42, outputTokens: 7 },
    });
    const map = buildLineUsageMap([content, otherKeyLine, usage]);
    expect(map.get(content)).toEqual({ inputTokens: 42, outputTokens: 7 });
  });
});

// ---------------------------------------------------------------------------
// latestUsageForLines
// ---------------------------------------------------------------------------

describe('latestUsageForLines', () => {
  it('returns undefined for empty lines', () => {
    const usageMap = new Map<DashboardAgentStreamEvent, LineTokenUsage>();
    expect(latestUsageForLines([], usageMap)).toBeUndefined();
  });

  it('returns undefined when no lines have usage in the map', () => {
    const line = makeLine({ content: 'no usage' });
    const usageMap = new Map<DashboardAgentStreamEvent, LineTokenUsage>();
    expect(latestUsageForLines([line], usageMap)).toBeUndefined();
  });

  it('returns usage for a single matching line', () => {
    const line = makeLine({ content: 'work' });
    const usage: LineTokenUsage = { inputTokens: 10, outputTokens: 5 };
    const usageMap = new Map<DashboardAgentStreamEvent, LineTokenUsage>([[line, usage]]);
    expect(latestUsageForLines([line], usageMap)).toEqual(usage);
  });

  it('returns the last usage found in iteration order', () => {
    const line1 = makeLine({ content: 'first' });
    const line2 = makeLine({ content: 'second' });
    const usage1: LineTokenUsage = { inputTokens: 10, outputTokens: 5 };
    const usage2: LineTokenUsage = { inputTokens: 20, outputTokens: 15 };
    const usageMap = new Map<DashboardAgentStreamEvent, LineTokenUsage>([
      [line1, usage1],
      [line2, usage2],
    ]);
    expect(latestUsageForLines([line1, line2], usageMap)).toEqual(usage2);
  });

  it('skips lines not in the map and returns the last found', () => {
    const line1 = makeLine({ content: 'has usage' });
    const line2 = makeLine({ content: 'no usage' });
    const line3 = makeLine({ content: 'also has usage' });
    const usage1: LineTokenUsage = { inputTokens: 10, outputTokens: 5 };
    const usage3: LineTokenUsage = { inputTokens: 30, outputTokens: 25 };
    const usageMap = new Map<DashboardAgentStreamEvent, LineTokenUsage>([
      [line1, usage1],
      [line3, usage3],
    ]);
    expect(latestUsageForLines([line1, line2, line3], usageMap)).toEqual(usage3);
  });
});

// ---------------------------------------------------------------------------
// deduplicateRefs
// ---------------------------------------------------------------------------

describe('deduplicateRefs', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateRefs([])).toEqual([]);
  });

  it('returns all refs when none are duplicates', () => {
    const refs = [
      makeRef({ type: 'canonical_specification', name: 'main', version: 1 }),
      makeRef({ type: 'plan', name: 'plan', version: 1 }),
    ];
    expect(deduplicateRefs(refs)).toHaveLength(2);
  });

  it('removes duplicate refs with same type, name, and version', () => {
    const ref1 = makeRef({
      type: 'canonical_specification',
      name: 'main',
      version: 1,
      checksum: 'aaa',
    });
    const ref2 = makeRef({
      type: 'canonical_specification',
      name: 'main',
      version: 1,
      checksum: 'bbb',
    });
    const result = deduplicateRefs([ref1, ref2]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(ref1);
  });

  it('keeps refs that differ by version', () => {
    const ref1 = makeRef({ type: 'canonical_specification', name: 'main', version: 1 });
    const ref2 = makeRef({ type: 'canonical_specification', name: 'main', version: 2 });
    expect(deduplicateRefs([ref1, ref2])).toHaveLength(2);
  });

  it('keeps refs that differ by name', () => {
    const ref1 = makeRef({ type: 'canonical_specification', name: 'alpha', version: 1 });
    const ref2 = makeRef({ type: 'canonical_specification', name: 'beta', version: 1 });
    expect(deduplicateRefs([ref1, ref2])).toHaveLength(2);
  });

  it('keeps refs that differ by type', () => {
    const ref1 = makeRef({ type: 'canonical_specification', name: 'main', version: 1 });
    const ref2 = makeRef({ type: 'plan', name: 'main', version: 1 });
    expect(deduplicateRefs([ref1, ref2])).toHaveLength(2);
  });

  it('preserves first occurrence in duplicate set', () => {
    const ref1 = makeRef({ checksum: 'first' });
    const ref2 = makeRef({ checksum: 'second' });
    const ref3 = makeRef({ checksum: 'third' });
    const result = deduplicateRefs([ref1, ref2, ref3]);
    expect(result).toHaveLength(1);
    expect(result[0]?.checksum).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// str
// ---------------------------------------------------------------------------

describe('str', () => {
  it('returns the value when it is a string', () => {
    expect(str('hello')).toBe('hello');
  });

  it('returns empty string for non-string without fallback', () => {
    expect(str(42)).toBe('');
    expect(str(null)).toBe('');
    expect(str(undefined)).toBe('');
    expect(str(true)).toBe('');
    expect(str({})).toBe('');
    expect(str([])).toBe('');
  });

  it('returns fallback for non-string values', () => {
    expect(str(42, 'fallback')).toBe('fallback');
    expect(str(null, 'n/a')).toBe('n/a');
    expect(str(undefined, 'default')).toBe('default');
  });

  it('returns empty string when value is string even if fallback provided', () => {
    expect(str('', 'fallback')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// humanizeRole
// ---------------------------------------------------------------------------

describe('humanizeRole', () => {
  it('converts snake_case role to title case', () => {
    expect(humanizeRole('lead_developer')).toBe('Lead Developer');
  });

  it('converts kebab-case role to title case', () => {
    expect(humanizeRole('ui-designer')).toBe('UI Designer');
  });

  it('converts camelCase role to title case', () => {
    expect(humanizeRole('codeReviewer')).toBe('Code Reviewer');
  });

  it('handles single word', () => {
    expect(humanizeRole('developer')).toBe('Developer');
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe('formatTime', () => {
  it('formats a valid ISO string to time', () => {
    const result = formatTime('2026-01-15T14:30:45Z');
    // Locale-dependent, but should contain the time parts
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns a non-empty string for valid date', () => {
    const result = formatTime('2026-06-01T09:15:30Z');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a string for invalid ISO input (catch branch or Invalid Date)', () => {
    const result = formatTime('not-a-date');
    // Depending on the environment, toLocaleTimeString on Invalid Date may throw
    // (caught, returns '') or return 'Invalid Date'
    expect(typeof result).toBe('string');
  });

  it('handles empty string', () => {
    // new Date('') produces Invalid Date
    const result = formatTime('');
    // Invalid Date.toLocaleTimeString() may throw or return 'Invalid Date' depending on env
    // The function catches errors and returns ''
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// classifySender
// ---------------------------------------------------------------------------

describe('classifySender', () => {
  it('returns orchestrator when protocolMessage.messageType is task_prompt', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'task_prompt', payload: {} },
    });
    expect(classifySender(line)).toBe('orchestrator');
  });

  it('returns orchestrator when roleId is orchestrator', () => {
    const line = makeLine({ roleId: 'orchestrator' });
    expect(classifySender(line)).toBe('orchestrator');
  });

  it('returns orchestrator when structuredData.sender is orchestrator', () => {
    const line = makeLine({ structuredData: { sender: 'orchestrator' } });
    expect(classifySender(line)).toBe('orchestrator');
  });

  it('returns human when roleId is human', () => {
    const line = makeLine({ roleId: 'human' });
    expect(classifySender(line)).toBe('human');
  });

  it('returns system for permission_request', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'permission_request', payload: {} },
    });
    expect(classifySender(line)).toBe('system');
  });

  it('returns system for permission_response', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'permission_response', payload: {} },
    });
    expect(classifySender(line)).toBe('system');
  });

  it('returns system for permission_resolved', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'permission_resolved', payload: {} },
    });
    expect(classifySender(line)).toBe('system');
  });

  it('returns system for clarification_request', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'clarification_request', payload: {} },
    });
    expect(classifySender(line)).toBe('system');
  });

  it('returns system for clarification_response', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'clarification_response', payload: {} },
    });
    expect(classifySender(line)).toBe('system');
  });

  it('returns agent for non-special roles with progress messageType', () => {
    const line = makeLine({
      roleId: 'developer',
      protocolMessage: { messageType: 'progress', payload: {} },
    });
    expect(classifySender(line)).toBe('agent');
  });

  it('returns agent for plain content lines', () => {
    const line = makeLine({ roleId: 'developer', content: 'hello' });
    expect(classifySender(line)).toBe('agent');
  });

  it('prioritizes orchestrator over human (task_prompt with roleId human)', () => {
    // The orchestrator check comes first, so task_prompt wins
    const line = makeLine({
      roleId: 'human',
      protocolMessage: { messageType: 'task_prompt', payload: {} },
    });
    expect(classifySender(line)).toBe('orchestrator');
  });
});

// ---------------------------------------------------------------------------
// senderLabel
// ---------------------------------------------------------------------------

describe('senderLabel', () => {
  it('returns "AI Dev Orchestrator" for orchestrator sender', () => {
    const line = makeLine({ roleId: 'orchestrator' });
    expect(senderLabel(line)).toBe('AI Dev Orchestrator');
  });

  it('returns "Human" for human sender', () => {
    const line = makeLine({ roleId: 'human' });
    expect(senderLabel(line)).toBe('Human');
  });

  it('returns "System" for system sender', () => {
    const line = makeLine({
      protocolMessage: { messageType: 'permission_request', payload: {} },
    });
    expect(senderLabel(line)).toBe('System');
  });

  it('returns humanized role for agent sender', () => {
    const line = makeLine({ roleId: 'lead_developer' });
    expect(senderLabel(line)).toBe('Lead Developer');
  });
});

// ---------------------------------------------------------------------------
// flushGroup
// ---------------------------------------------------------------------------

describe('flushGroup', () => {
  it('returns undefined for null input', () => {
    expect(flushGroup(null)).toBeUndefined();
  });

  it('returns a MessageGroup from a non-null input', () => {
    const lines = [makeLine()];
    const result = flushGroup({
      sender: 'agent',
      label: 'Developer',
      stateId: 'state-1',
      lines,
    });
    expect(result).toEqual({
      sender: 'agent',
      senderLabel: 'Developer',
      stateId: 'state-1',
      lines,
    });
  });

  it('includes undefined stateId when not set', () => {
    const result = flushGroup({
      sender: 'orchestrator',
      label: 'AI Dev Orchestrator',
      stateId: undefined,
      lines: [makeLine()],
    });
    expect(result?.stateId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// groupMessages
// ---------------------------------------------------------------------------

describe('groupMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('groups consecutive messages from the same sender', () => {
    const line1 = makeLine({ roleId: 'developer', content: 'hello' });
    const line2 = makeLine({ roleId: 'developer', content: 'world' });
    const groups = groupMessages([line1, line2]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toHaveLength(2);
    expect(groups[0]?.sender).toBe('agent');
  });

  it('creates separate groups for different senders', () => {
    const agentLine = makeLine({ roleId: 'developer', content: 'code' });
    const orchestratorLine = makeLine({ roleId: 'orchestrator', content: 'task' });
    const groups = groupMessages([agentLine, orchestratorLine]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.sender).toBe('agent');
    expect(groups[1]?.sender).toBe('orchestrator');
  });

  it('isolates system messages into their own group', () => {
    const agentLine = makeLine({ roleId: 'developer', content: 'work' });
    const systemLine = makeLine({
      protocolMessage: { messageType: 'permission_request', payload: {} },
    });
    const agentLine2 = makeLine({ roleId: 'developer', content: 'resume' });
    const groups = groupMessages([agentLine, systemLine, agentLine2]);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.sender).toBe('agent');
    expect(groups[1]?.sender).toBe('system');
    expect(groups[1]?.lines).toHaveLength(1);
    expect(groups[2]?.sender).toBe('agent');
  });

  it('splits groups when sender label changes even if sender type is the same', () => {
    const devLine = makeLine({ roleId: 'developer', content: 'dev work' });
    const reviewerLine = makeLine({ roleId: 'reviewer', content: 'review' });
    const groups = groupMessages([devLine, reviewerLine]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.senderLabel).toBe('Developer');
    expect(groups[1]?.senderLabel).toBe('Reviewer');
  });

  it('assigns stateId from the first line with a stateId', () => {
    const line1 = makeLine({ roleId: 'developer', stateId: '', content: 'no state' });
    const line2 = makeLine({ roleId: 'developer', stateId: 'PLANNING', content: 'has state' });
    const groups = groupMessages([line1, line2]);
    expect(groups).toHaveLength(1);
    // stateId from line1 is '' (falsy), so line2's stateId should be used
    expect(groups[0]?.stateId).toBe('PLANNING');
  });

  it('preserves stateId from initial line when already set', () => {
    const line1 = makeLine({ roleId: 'developer', stateId: 'INTAKE', content: 'first' });
    const line2 = makeLine({ roleId: 'developer', stateId: 'PLANNING', content: 'second' });
    const groups = groupMessages([line1, line2]);
    expect(groups).toHaveLength(1);
    // stateId is set from the group constructor using line1, so it stays INTAKE
    expect(groups[0]?.stateId).toBe('INTAKE');
  });

  it('handles multiple system messages creating separate groups each', () => {
    const sys1 = makeLine({
      roleId: 'developer',
      protocolMessage: { messageType: 'permission_request', payload: {} },
    });
    const sys2 = makeLine({
      roleId: 'developer',
      protocolMessage: { messageType: 'permission_response', payload: {} },
    });
    const groups = groupMessages([sys1, sys2]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.sender).toBe('system');
    expect(groups[1]?.sender).toBe('system');
  });

  it('splits groups when dispatchId differs even if role is the same', () => {
    const line1 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'dispatch-1', content: 'a' });
    const line2 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'dispatch-2', content: 'b' });
    const groups = groupMessages([line1, line2]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.senderLabel).toBe('Task Spec Writer');
    expect(groups[0]?.lines).toHaveLength(1);
    expect(groups[1]?.senderLabel).toBe('Task Spec Writer');
    expect(groups[1]?.lines).toHaveLength(1);
  });

  it('still groups consecutive messages from the same dispatchId', () => {
    const line1 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'dispatch-1', content: 'a' });
    const line2 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'dispatch-1', content: 'b' });
    const groups = groupMessages([line1, line2]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.lines).toHaveLength(2);
  });

  it('interleaved dispatches produce separate groups per dispatch', () => {
    const a1 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'd-1', content: 'a1' });
    const b1 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'd-2', content: 'b1' });
    const a2 = makeLine({ roleId: 'task_spec_writer', dispatchId: 'd-1', content: 'a2' });
    const groups = groupMessages([a1, b1, a2]);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.lines[0]?.content).toBe('a1');
    expect(groups[1]?.lines[0]?.content).toBe('b1');
    expect(groups[2]?.lines[0]?.content).toBe('a2');
  });
});

// ---------------------------------------------------------------------------
// buildRoleMetaMap
// ---------------------------------------------------------------------------

describe('buildRoleMetaMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildRoleMetaMap([]).size).toBe(0);
  });

  it('returns empty map when no task_prompt lines exist', () => {
    const line = makeLine({ content: 'hello' });
    expect(buildRoleMetaMap([line]).size).toBe(0);
  });

  it('extracts model and runner from protocolMessage task_prompt', () => {
    const line = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'claude-sonnet', runner: 'claude-code' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')).toEqual({ model: 'claude-sonnet', runner: 'claude-code' });
  });

  it('extracts model and runner from structuredData task_prompt', () => {
    const line = makeLine({
      roleId: 'developer',
      structuredData: {
        messageType: 'task_prompt',
        role: 'developer',
        model: 'claude-opus',
        runner: 'cursor',
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')).toEqual({ model: 'claude-opus', runner: 'cursor' });
  });

  it('skips orchestrator role', () => {
    const line = makeLine({
      roleId: 'orchestrator',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'orchestrator', model: 'some-model' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.size).toBe(0);
  });

  it('skips human role', () => {
    const line = makeLine({
      roleId: 'human',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'human', model: 'some-model' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.size).toBe(0);
  });

  it('falls back to roleId when payload.role is empty', () => {
    const line = makeLine({
      roleId: 'tester',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { model: 'claude-sonnet' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.has('tester')).toBe(true);
  });

  it('sets model to undefined when model is "agent"', () => {
    const line = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'agent' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')?.model).toBeUndefined();
  });

  it('sets model to undefined when model is empty string', () => {
    const line = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: '' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')?.model).toBeUndefined();
  });

  it('falls back to structuredData.runner when payload.runner is empty', () => {
    const line = makeLine({
      roleId: 'developer',
      structuredData: { runner: 'gh-copilot' },
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'gpt-4' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')?.runner).toBe('gh-copilot');
  });

  it('sets runner to undefined when no runner available', () => {
    const line = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'claude-sonnet' },
      },
    });
    const map = buildRoleMetaMap([line]);
    expect(map.get('developer')?.runner).toBeUndefined();
  });

  it('overwrites earlier entries for the same role', () => {
    const line1 = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'old-model', runner: 'old-runner' },
      },
    });
    const line2 = makeLine({
      roleId: 'developer',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { role: 'developer', model: 'new-model', runner: 'new-runner' },
      },
    });
    const map = buildRoleMetaMap([line1, line2]);
    expect(map.get('developer')).toEqual({ model: 'new-model', runner: 'new-runner' });
  });
});

// ---------------------------------------------------------------------------
// buildDispatchPromptMap
// ---------------------------------------------------------------------------

describe('buildDispatchPromptMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildDispatchPromptMap([]).size).toBe(0);
  });

  it('returns empty map when no task_prompt or cli_prompt lines exist', () => {
    const line = makeLine({ content: 'hello' });
    expect(buildDispatchPromptMap([line]).size).toBe(0);
  });

  it('extracts rolePrompt from protocolMessage task_prompt', () => {
    const line = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: 'Build the feature' },
      },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.get('d1')).toBe('Build the feature');
  });

  it('extracts rolePrompt from structuredData task_prompt', () => {
    const line = makeLine({
      dispatchId: 'd1',
      structuredData: { messageType: 'task_prompt', rolePrompt: 'Build it' },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.get('d1')).toBe('Build it');
  });

  it('extracts cliPrompt from cli_prompt messageType', () => {
    // msgType is resolved from protocolMessage first, so this is task_prompt
    // but rolePrompt is empty so nothing stored for d2 via task_prompt branch
    // Let's make one that truly has cli_prompt messageType
    const cliLine = makeLine({
      dispatchId: 'd3',
      structuredData: { messageType: 'cli_prompt', cliPrompt: 'Execute build' },
    });
    const map = buildDispatchPromptMap([cliLine]);
    expect(map.get('d3')).toBe('Execute build');
  });

  it('extracts cliPrompt from protocolMessage with cli_prompt messageType', () => {
    // Note: ParsedProtocolMessage type constrains messageType, but the code
    // reads it as a string from structuredData fallback
    const line = makeLine({
      dispatchId: 'd4',
      structuredData: { messageType: 'cli_prompt', cliPrompt: 'npm test' },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.get('d4')).toBe('npm test');
  });

  it('skips task_prompt when rolePrompt is empty', () => {
    const line = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: '' },
      },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.has('d1')).toBe(false);
  });

  it('skips cli_prompt when cliPrompt is empty', () => {
    const line = makeLine({
      dispatchId: 'd1',
      structuredData: { messageType: 'cli_prompt', cliPrompt: '' },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.has('d1')).toBe(false);
  });

  it('skips lines with empty dispatchId for task_prompt', () => {
    const line = makeLine({
      dispatchId: '',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: 'prompt text' },
      },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.size).toBe(0);
  });

  it('skips lines with empty dispatchId for cli_prompt', () => {
    const line = makeLine({
      dispatchId: '',
      structuredData: { messageType: 'cli_prompt', cliPrompt: 'prompt text' },
    });
    const map = buildDispatchPromptMap([line]);
    expect(map.size).toBe(0);
  });

  it('overwrites earlier prompt for the same dispatchId', () => {
    const line1 = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: 'First prompt' },
      },
    });
    const line2 = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: 'Updated prompt' },
      },
    });
    const map = buildDispatchPromptMap([line1, line2]);
    expect(map.get('d1')).toBe('Updated prompt');
  });

  it('handles both task_prompt and cli_prompt for different dispatches', () => {
    const taskLine = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { rolePrompt: 'Build it' },
      },
    });
    const cliLine = makeLine({
      dispatchId: 'd2',
      structuredData: { messageType: 'cli_prompt', cliPrompt: 'Run tests' },
    });
    const map = buildDispatchPromptMap([taskLine, cliLine]);
    expect(map.get('d1')).toBe('Build it');
    expect(map.get('d2')).toBe('Run tests');
  });
});

// ---------------------------------------------------------------------------
// buildDispatchDescriptionMap
// ---------------------------------------------------------------------------

describe('buildDispatchDescriptionMap', () => {
  it('returns empty map for empty input', () => {
    expect(buildDispatchDescriptionMap([]).size).toBe(0);
  });

  it('extracts description from protocolMessage task_prompt', () => {
    const line = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: 'Review implementation for correctness' },
      },
    });
    const map = buildDispatchDescriptionMap([line]);
    expect(map.get('d1')).toBe('Review implementation for correctness');
  });

  it('extracts description from structuredData task_prompt', () => {
    const line = makeLine({
      dispatchId: 'd1',
      structuredData: { messageType: 'task_prompt', description: 'Check security' },
    });
    const map = buildDispatchDescriptionMap([line]);
    expect(map.get('d1')).toBe('Check security');
  });

  it('skips task_prompt when description is empty', () => {
    const line = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: '' },
      },
    });
    const map = buildDispatchDescriptionMap([line]);
    expect(map.has('d1')).toBe(false);
  });

  it('skips lines with empty dispatchId', () => {
    const line = makeLine({
      dispatchId: '',
      protocolMessage: {
        messageType: 'task_prompt',
        payload: { description: 'Some task' },
      },
    });
    const map = buildDispatchDescriptionMap([line]);
    expect(map.size).toBe(0);
  });

  it('ignores non-task_prompt lines', () => {
    const line = makeLine({
      dispatchId: 'd1',
      protocolMessage: {
        messageType: 'progress',
        payload: { description: 'Not a task prompt' },
      },
    });
    const map = buildDispatchDescriptionMap([line]);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeAllLines
// ---------------------------------------------------------------------------

describe('mergeAllLines', () => {
  it('returns empty array for empty groups', () => {
    const groups = new Map<string, DispatchGroup>();
    expect(mergeAllLines(groups)).toEqual([]);
  });

  it('merges lines from multiple groups', () => {
    const line1 = makeLine({ timestamp: '2026-01-15T10:00:01Z', content: 'first' });
    const line2 = makeLine({ timestamp: '2026-01-15T10:00:02Z', content: 'second' });
    const groups = new Map<string, DispatchGroup>([
      ['g1', { dispatchId: 'd1', roleId: 'dev', stateId: 's1', lines: [line2] }],
      ['g2', { dispatchId: 'd2', roleId: 'reviewer', stateId: 's1', lines: [line1] }],
    ]);
    const result = mergeAllLines(groups);
    expect(result).toHaveLength(2);
    expect(result[0]?.content).toBe('first');
    expect(result[1]?.content).toBe('second');
  });

  it('sorts lines by timestamp', () => {
    const lineC = makeLine({ timestamp: '2026-01-15T10:00:03Z', content: 'C' });
    const lineA = makeLine({ timestamp: '2026-01-15T10:00:01Z', content: 'A' });
    const lineB = makeLine({ timestamp: '2026-01-15T10:00:02Z', content: 'B' });
    const groups = new Map<string, DispatchGroup>([
      ['g1', { dispatchId: 'd1', roleId: 'dev', stateId: 's1', lines: [lineC, lineA] }],
      ['g2', { dispatchId: 'd2', roleId: 'dev', stateId: 's1', lines: [lineB] }],
    ]);
    const result = mergeAllLines(groups);
    expect(result.map((l) => l.content)).toEqual(['A', 'B', 'C']);
  });

  it('handles groups with empty lines', () => {
    const line = makeLine({ content: 'only' });
    const groups = new Map<string, DispatchGroup>([
      ['g1', { dispatchId: 'd1', roleId: 'dev', stateId: 's1', lines: [] }],
      ['g2', { dispatchId: 'd2', roleId: 'dev', stateId: 's1', lines: [line] }],
    ]);
    const result = mergeAllLines(groups);
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('only');
  });
});

// ---------------------------------------------------------------------------
// Exported constants (smoke tests)
// ---------------------------------------------------------------------------

describe('exported style constants', () => {
  it('senderBorderColor has all sender types', () => {
    const senders: MessageSender[] = ['orchestrator', 'agent', 'human', 'system'];
    for (const s of senders) {
      expect(senderBorderColor[s]).toBeTruthy();
    }
  });

  it('senderLabelColor has all sender types', () => {
    const senders: MessageSender[] = ['orchestrator', 'agent', 'human', 'system'];
    for (const s of senders) {
      expect(senderLabelColor[s]).toBeTruthy();
    }
  });

  it('logLevelStyles has expected levels', () => {
    expect(logLevelStyles['debug']).toBeTruthy();
    expect(logLevelStyles['info']).toBeTruthy();
    expect(logLevelStyles['warn']).toBeTruthy();
    expect(logLevelStyles['error']).toBeTruthy();
  });

  it('logLevelIcons has warn and error', () => {
    expect(logLevelIcons['warn']).toBeTruthy();
    expect(logLevelIcons['error']).toBeTruthy();
  });
});
