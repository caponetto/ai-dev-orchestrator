import type { PermissionRequestPayload } from '@ai-orchestrator/agent-protocol';
import type {
  PermissionContext,
  PermissionDecision,
  PermissionPolicy,
  PermissionPolicyConfig,
  PermissionRule,
  RoleTrustLevel,
} from '@ai-orchestrator/ports';
import { AI_CONFIG_DIR_NAME } from '@ai-orchestrator/schemas';
import type { RoleId } from '@ai-orchestrator/schemas';

import type { PermissionApprovalStore } from './permission-approval-store';

const DEFAULT_ROLE_TRUST: Readonly<Partial<Record<RoleId, RoleTrustLevel>>> = {
  implementer: 'high',
  verifier: 'medium',
  planner: 'medium',
  context_analyst: 'medium',
  report_synthesizer: 'medium',
  review_findings_writer: 'medium',
  design_reviewer: 'none',
  static_reviewer: 'none',
  security_reviewer: 'none',
  performance_reviewer: 'none',
  adversarial_reviewer: 'none',
  docs_reviewer: 'none',
  ux_reviewer: 'none',
  plan_reviewer: 'none',
};

export class DefaultPermissionPolicy implements PermissionPolicy {
  private readonly config: PermissionPolicyConfig;
  private readonly approvalStore?: PermissionApprovalStore;

  constructor(config?: Partial<PermissionPolicyConfig>, approvalStore?: PermissionApprovalStore) {
    this.config = {
      defaultAction: config?.defaultAction ?? 'ask_human',
      rules: config?.rules,
      roleTrust: config?.roleTrust,
      safeCommands: config?.safeCommands,
    };
    this.approvalStore = approvalStore;
  }

  evaluate(request: PermissionRequestPayload, context: PermissionContext): PermissionDecision {
    const denyMatch = this.findMatchingRule(request, 'deny', context.repoRoot);
    if (denyMatch) {
      return {
        action: 'deny',
        reason:
          `Denied by rule: ${denyMatch.action} ${denyMatch.pattern ?? denyMatch.scope ?? ''}`.trim(),
      };
    }

    const grantMatch = this.findMatchingRule(request, 'grant', context.repoRoot);
    if (grantMatch) {
      return {
        action: 'grant',
        reason: `Granted by rule: ${grantMatch.action} ${grantMatch.scope ?? ''}`.trim(),
      };
    }

    if (this.approvalStore) {
      const match = this.approvalStore.findMatch(request.action, request.resource);
      if (match) {
        return {
          action: 'grant',
          reason: `previously_approved:${match.id}`,
        };
      }
    }

    if (targetsRunDirectory(request)) {
      return {
        action: 'grant',
        reason: 'Auto-approved: operation targets .ai run directory',
      };
    }

    if (isReadOnlyOperation(request)) {
      return {
        action: 'grant',
        reason: 'Auto-approved: read-only operation',
      };
    }

    const trustLevel = this.getRoleTrust(context.role);

    if (trustLevel === 'none') {
      return { action: 'deny', reason: `Role "${context.role}" has trust level "none"` };
    }

    if (trustLevel === 'high') {
      if (isDestructiveCommand(request)) {
        return { action: 'ask_human', reason: 'Destructive command requires human approval' };
      }
      return {
        action: 'grant',
        reason: `Auto-approved: role "${context.role}" has high trust`,
      };
    }

    if (isSafeToolCall(request, this.config.safeCommands)) {
      return {
        action: 'grant',
        reason: `Auto-approved: "${request.detail}" is a safe operation for medium trust`,
      };
    }

    if (request.riskLevel === 'low') {
      return {
        action: 'grant',
        reason: `Auto-approved: role "${context.role}" has medium trust for low risk`,
      };
    }

    if (isDestructiveCommand(request)) {
      return { action: 'ask_human', reason: 'Destructive command requires human approval' };
    }

    return { action: this.config.defaultAction, reason: 'Default policy action' };
  }

  private getRoleTrust(role: string): RoleTrustLevel {
    const configTrust = this.config.roleTrust?.[role];
    if (configTrust) {
      return configTrust;
    }
    return DEFAULT_ROLE_TRUST[role as RoleId] ?? 'medium';
  }

  private findMatchingRule(
    request: PermissionRequestPayload,
    decision: 'grant' | 'deny',
    repoRoot?: string,
  ): PermissionRule | undefined {
    if (!this.config.rules) {
      return undefined;
    }

    return this.config.rules.find((rule) => {
      if (rule.decision !== decision) {
        return false;
      }
      if (rule.action !== request.action) {
        return false;
      }
      if (rule.pattern && !resourceMatchesPattern(request.resource, rule.pattern, repoRoot)) {
        return false;
      }
      if (rule.scope && !resourceMatchesPattern(request.resource, rule.scope, repoRoot)) {
        return false;
      }
      return true;
    });
  }
}

function resourceMatchesPattern(resource: string, pattern: string, repoRoot?: string): boolean {
  if (pattern === '*' || pattern === '**') {
    return true;
  }

  const resolved = repoRoot
    ? pattern.replace(/\$\{repoRoot\}/g, repoRoot)
    : pattern.replace(/\$\{repoRoot\}/g, '');

  if (resolved.endsWith('/**')) {
    const prefix = resolved.slice(0, -3);
    const cleanPrefix = prefix.startsWith('/') ? prefix.slice(1) : prefix;
    if (!cleanPrefix) {
      return true;
    }
    return startsWithAtBoundary(resource, cleanPrefix);
  }

  if (resolved.endsWith('/*')) {
    const prefix = resolved.slice(0, -2);
    const cleanPrefix = prefix.startsWith('/') ? prefix.slice(1) : prefix;
    if (!cleanPrefix) {
      return !resource.includes('/');
    }
    if (!startsWithAtBoundary(resource, cleanPrefix)) {
      return false;
    }
    const remainder = resource.startsWith('/' + cleanPrefix)
      ? resource.slice(cleanPrefix.length + 2)
      : resource.slice(cleanPrefix.length + 1);
    return !remainder.includes('/');
  }

  if (resolved.includes('*')) {
    const regex = new RegExp(
      '^' + resolved.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return regex.test(resource);
  }

  return resource === resolved;
}

function startsWithAtBoundary(resource: string, prefix: string): boolean {
  const r = resource.startsWith('/') ? resource.slice(1) : resource;
  return r === prefix || r.startsWith(prefix + '/');
}

const SAFE_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Cat',
  'Find',
  'WebFetch',
  'WebSearch',
  'Write',
  'Edit',
  'MultiEdit',
  'StrReplace',
  'TodoRead',
  'TodoWrite',
  'ListDir',
  'ReadFile',
  'SearchFiles',
]);

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i,
  /\bgit\s+(push\s+--force|reset\s+--hard|clean\s+-fd)/i,
  /\b(mkfs|dd\s+if=|format|fdisk)\b/i,
  /\b(drop\s+(table|database)|truncate\s+table)\b/i,
  /\b(chmod\s+777|chown\s+root)\b/i,
];

const SAFE_SHELL_COMMANDS =
  /^\s*(cat|awk|grep|egrep|fgrep|rg|head|tail|wc|sort|uniq|cut|tr|sed|jq|yq|less|more|file|stat|du|df|ls|find|echo|printf|diff|comm|tee|xargs|curl|env|printenv|python3|node)\b/;

function isSafeShellCommand(command: string, projectSafeCommands?: readonly string[]): boolean {
  if (SAFE_SHELL_COMMANDS.test(command)) {
    return true;
  }
  if (projectSafeCommands && projectSafeCommands.length > 0) {
    const trimmed = command.trimStart();
    return projectSafeCommands.some(
      (prefix) =>
        trimmed.startsWith(prefix + ' ') || trimmed.startsWith(prefix + '/') || trimmed === prefix,
    );
  }
  return false;
}

function isSafeToolCall(
  request: PermissionRequestPayload,
  projectSafeCommands?: readonly string[],
): boolean {
  const detail = request.detail;
  const toolName = detail.split(':')[0].trim();
  if (SAFE_TOOLS.has(toolName)) {
    return true;
  }
  if (request.action === 'file_read') {
    return true;
  }
  if (request.action === 'shell_execute') {
    const command = request.toolInput?.['command'];
    if (typeof command === 'string') {
      return isSafeShellCommand(command, projectSafeCommands);
    }
  }
  return false;
}

function isDestructiveCommand(request: PermissionRequestPayload): boolean {
  const command = request.toolInput?.['command'];
  if (typeof command !== 'string') {
    return false;
  }
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}

const AI_DIR_SEGMENT = `/${AI_CONFIG_DIR_NAME}/`;

function targetsRunDirectory(request: PermissionRequestPayload): boolean {
  const candidates = [
    request.resource,
    typeof request.toolInput?.['file_path'] === 'string' ? request.toolInput['file_path'] : '',
    typeof request.toolInput?.['path'] === 'string' ? request.toolInput['path'] : '',
    typeof request.toolInput?.['command'] === 'string' ? request.toolInput['command'] : '',
  ];
  return candidates.some((c) => c.includes(AI_DIR_SEGMENT));
}

const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Cat',
  'Find',
  'WebFetch',
  'WebSearch',
  'TodoRead',
  'ListDir',
  'ReadFile',
  'SearchFiles',
]);

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'fetch',
  'for-each-ref',
  'log',
  'ls-files',
  'ls-tree',
  'merge-base',
  'name-rev',
  'reflog',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'status',
]);

const GIT_SUBCOMMAND_READ_ONLY_ACTIONS: Readonly<Partial<Record<string, ReadonlySet<string>>>> = {
  remote: new Set(['show', 'get-url']),
  branch: new Set(['list']),
  tag: new Set(['list']),
};

const GH_READ_ONLY_ACTIONS: Readonly<Partial<Record<string, ReadonlySet<string>>>> = {
  pr: new Set(['view', 'diff', 'list', 'checks', 'status']),
  issue: new Set(['view', 'list']),
  repo: new Set(['view']),
  auth: new Set(['status']),
};

const GIT_VALUE_TAKING_FLAGS = /^-[Cc]$/;

const GIT_VALUE_TAKING_LONG_FLAGS = new Set([
  '--contains',
  '--format',
  '--merged',
  '--no-merged',
  '--points-at',
  '--sort',
]);

function isReadOnlyOperation(request: PermissionRequestPayload): boolean {
  if (request.action === 'file_read') {
    return true;
  }

  const toolName = request.detail.split(':')[0].trim();
  if (READ_ONLY_TOOLS.has(toolName)) {
    return true;
  }

  if (request.action === 'shell_execute') {
    const command = request.toolInput?.['command'];
    if (typeof command === 'string') {
      return isReadOnlyVcsCommand(command);
    }
  }

  return false;
}

const SAFE_READ_ONLY_UTILITIES = new Set([
  'cat',
  'echo',
  'head',
  'printf',
  'sort',
  'tail',
  'uniq',
  'wc',
]);

function isReadOnlyVcsCommand(command: string): boolean {
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);
  if (segments.length === 0) {
    return false;
  }
  return segments.every(isReadOnlySegment);
}

function hasFileOutputRedirection(segment: string): boolean {
  return /(?<![12&])>\s*\S/.test(segment);
}

function isReadOnlySegment(segment: string): boolean {
  const pipeHead = segment.split(/\s*\|\s*/)[0].trim();
  const cleaned = pipeHead.replaceAll(/\s*[12]?>&?\d*\s*/g, ' ').trim();
  if (!cleaned) {
    return false;
  }
  if (cleaned.startsWith('cd ')) {
    return true;
  }
  if (cleaned.startsWith('git ') || cleaned === 'git') {
    return isReadOnlyGitCommand(cleaned);
  }
  if (cleaned.startsWith('gh ')) {
    return isReadOnlyGhCommand(cleaned);
  }
  if (hasFileOutputRedirection(pipeHead)) {
    return false;
  }
  const cmd = cleaned.split(/\s+/)[0];
  return SAFE_READ_ONLY_UTILITIES.has(cmd);
}

function isReadOnlyGhCommand(command: string): boolean {
  const parts = command.split(/\s+/);
  if (parts.length < 3) {
    return false;
  }
  const group = parts[1];
  const action = parts[2];
  const allowedActions = GH_READ_ONLY_ACTIONS[group];
  return allowedActions?.has(action) ?? false;
}

function isReadOnlyGitCommand(command: string): boolean {
  const cleaned = command.replaceAll(/\s*[12]?>&?\d*\s*/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  let subcommandIdx = -1;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part.startsWith('-')) {
      subcommandIdx = i;
      break;
    }
    if (GIT_VALUE_TAKING_FLAGS.test(part)) {
      i++;
    }
  }
  if (subcommandIdx === -1) {
    return false;
  }

  const subcommand = parts[subcommandIdx];
  if (GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return true;
  }

  const allowedActions = GIT_SUBCOMMAND_READ_ONLY_ACTIONS[subcommand];
  if (!allowedActions) {
    return false;
  }

  const tail = parts.slice(subcommandIdx + 1);
  const remaining: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const t = tail[i];
    if (t.startsWith('--') && t.includes('=')) {
      continue;
    }
    if (t.startsWith('-')) {
      if (GIT_VALUE_TAKING_LONG_FLAGS.has(t)) {
        i++;
      }
      continue;
    }
    remaining.push(t);
  }
  if (remaining.length === 0) {
    return true;
  }
  return allowedActions.has(remaining[0]);
}
