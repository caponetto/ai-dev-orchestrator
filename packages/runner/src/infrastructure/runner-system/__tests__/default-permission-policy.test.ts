import type { PermissionRequestPayload } from '@ai-orchestrator/agent-protocol';
import type { PermissionContext } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { DefaultPermissionPolicy } from '../default-permission-policy';

function makeRequest(overrides: Partial<PermissionRequestPayload> = {}): PermissionRequestPayload {
  return {
    action: 'file_write',
    resource: 'src/main.ts',
    detail: 'Write file',
    riskLevel: 'low',
    ...overrides,
  };
}

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    role: 'implementer',
    runId: 'run-1',
    stateId: 'IMPLEMENTING',
    repoRoot: '/repo',
    ...overrides,
  };
}

describe('DefaultPermissionPolicy', () => {
  describe('role trust levels', () => {
    it('auto-approves low risk for high-trust role (implementer)', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'implementer' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('auto-approves medium risk for high-trust role (implementer)', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'implementer' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('auto-approves high risk for high-trust role when not destructive', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'high', toolInput: { command: 'gh pr view 123' } }),
        makeContext({ role: 'implementer' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('asks human for destructive commands even for high-trust role', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'high', toolInput: { command: 'rm -rf /tmp/data' } }),
        makeContext({ role: 'implementer' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('auto-approves low risk for medium-trust role (verifier)', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('falls back to default for medium risk with medium-trust role', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('denies all for no-trust role (static_reviewer)', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).toBe('deny');
    });

    it('grants low-risk for unknown roles (medium trust fallback)', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('escalates medium-risk for unknown roles to default action', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('ask_human');
    });
  });

  describe('explicit rules', () => {
    it('deny rules take precedence over trust', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'shell_execute', decision: 'deny', pattern: 'rm -rf*' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'shell_execute', resource: 'rm -rf /', riskLevel: 'low' }),
        makeContext({ role: 'implementer' }),
      );
      expect(decision.action).toBe('deny');
    });

    it('grant rules take precedence over default action', () => {
      const policy = new DefaultPermissionPolicy({
        defaultAction: 'deny',
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_write', resource: 'src/index.ts', riskLevel: 'low' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('rules only match on matching action type', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_read', decision: 'grant' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_write', riskLevel: 'low' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).not.toBe('grant');
    });
  });

  describe('scope pattern matching', () => {
    it('matches glob ** patterns', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'src/deep/nested/file.ts' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('resolves ${repoRoot} to context repoRoot and matches', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_read', decision: 'grant', scope: '${repoRoot}/src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_read', resource: '/repo/src/file.ts' }),
        makeContext({ role: 'unknown_role', repoRoot: '/repo' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('does not match when ${repoRoot} resolves and resource is outside', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: '${repoRoot}/src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_write', resource: 'other/src/file.ts' }),
        makeContext({ role: 'static_reviewer', repoRoot: '/repo' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('falls back to stripping ${repoRoot} when context has no repoRoot', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_read', decision: 'grant', scope: '${repoRoot}/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_read', resource: 'any/file.ts' }),
        makeContext({ role: 'unknown_role', repoRoot: undefined }),
      );
      expect(decision.action).toBe('grant');
    });

    it('does not match when scope misses', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'test/file.ts' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('subtree pattern src/** does not match sibling path src-evil/file.ts', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'src-evil/file.ts' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('subtree pattern src/** matches src/sub/file.ts', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'src/sub/file.ts' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('single-level pattern src/* does not match sibling path src-evil/file.ts', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/*' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'src-evil/file.ts' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('single-level pattern src/* matches src/file.ts but not src/sub/file.ts', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/*' }],
      });
      const match = policy.evaluate(
        makeRequest({ resource: 'src/file.ts' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(match.action).toBe('grant');

      const noMatch = policy.evaluate(
        makeRequest({ resource: 'src/sub/file.ts' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(noMatch.action).not.toBe('grant');
    });

    it('resolved ${repoRoot}/src/** does not match /repo/src-evil/file.ts', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: '${repoRoot}/src/**' }],
      });
      const decision = policy.evaluate(
        makeRequest({ action: 'file_write', resource: '/repo/src-evil/file.ts' }),
        makeContext({ role: 'static_reviewer', repoRoot: '/repo' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('exact pattern does not substring-match', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'resources/src-old/foo' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('exact pattern matches exactly', () => {
      const policy = new DefaultPermissionPolicy({
        rules: [{ action: 'file_write', decision: 'grant', scope: 'src/main.ts' }],
      });
      const decision = policy.evaluate(
        makeRequest({ resource: 'src/main.ts' }),
        makeContext({ role: 'unknown_role' }),
      );
      expect(decision.action).toBe('grant');
    });
  });

  describe('custom role trust config', () => {
    it('overrides built-in trust levels', () => {
      const policy = new DefaultPermissionPolicy({
        roleTrust: { static_reviewer: 'high' },
      });
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'static_reviewer' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('assigns trust to custom roles', () => {
      const policy = new DefaultPermissionPolicy({
        roleTrust: { custom_agent: 'medium' },
      });
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'low' }),
        makeContext({ role: 'custom_agent' }),
      );
      expect(decision.action).toBe('grant');
    });
  });

  describe('default action', () => {
    it('uses ask_human as default', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('respects configured defaultAction', () => {
      const policy = new DefaultPermissionPolicy({ defaultAction: 'deny' });
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('deny');
    });

    it('respects configured defaultAction grant', () => {
      const policy = new DefaultPermissionPolicy({ defaultAction: 'grant' });
      const decision = policy.evaluate(
        makeRequest({ riskLevel: 'medium' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
    });
  });

  describe('.ai directory auto-grant', () => {
    it('auto-grants file_write within .ai run directory', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'file_write',
          resource: '/repo/.ai/runs/run-123/artifacts/spec.json',
          riskLevel: 'medium',
        }),
        makeContext({ role: 'verifier', repoRoot: '/repo' }),
      );
      expect(decision.action).toBe('grant');
      expect(decision.reason).toContain('.ai run directory');
    });

    it('auto-grants file_write via toolInput path within .ai directory', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'file_write',
          resource: '',
          riskLevel: 'medium',
          toolInput: { file_path: '/repo/.ai/runs/run-456/artifacts/output.json' },
        }),
        makeContext({ role: 'context_analyst', repoRoot: '/repo' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('auto-grants shell commands that target .ai directory', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          resource: '',
          riskLevel: 'high',
          toolInput: { command: 'cat /repo/.ai/runs/run-123/artifacts/spec.json | jq .' },
        }),
        makeContext({ role: 'verifier', repoRoot: '/repo' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('does not auto-grant actions outside .ai directory', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'file_write',
          resource: '/repo/src/main.ts',
          riskLevel: 'medium',
        }),
        makeContext({ role: 'verifier', repoRoot: '/repo' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('does not auto-grant shell commands not referencing .ai', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          resource: '',
          riskLevel: 'medium',
          toolInput: { command: 'rm -rf /tmp/data' },
        }),
        makeContext({ role: 'verifier', repoRoot: '/repo' }),
      );
      expect(decision.action).not.toBe('grant');
    });

    it('auto-grants even for no-trust roles operating on .ai', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'file_write',
          resource: '/repo/.ai/runs/run-789/artifacts/review.json',
          riskLevel: 'high',
        }),
        makeContext({ role: 'static_reviewer', repoRoot: '/repo' }),
      );
      expect(decision.action).toBe('grant');
    });
  });

  describe('safe shell commands', () => {
    it('auto-grants built-in safe commands like cat for medium-trust', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'cat /tmp/output.json' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('auto-grants read-only gh commands for medium-trust via read-only check', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'gh pr view 123' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
      expect(decision.reason).toContain('read-only');
    });

    it('asks human for non-safe write commands for medium-trust', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'gh pr merge 123' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('asks human for wget commands for medium-trust', () => {
      const policy = new DefaultPermissionPolicy();
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'wget https://api.example.com' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('auto-grants project safeCommands config matches', () => {
      const policy = new DefaultPermissionPolicy({
        safeCommands: ['npm', 'node'],
      });
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'npm test' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('does not auto-grant commands not in project safeCommands', () => {
      const policy = new DefaultPermissionPolicy({
        safeCommands: ['npm', 'node'],
      });
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'wget https://internal-api.example.com' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('project safeCommands matches exact command name', () => {
      const policy = new DefaultPermissionPolicy({
        safeCommands: ['node'],
      });
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'high',
          toolInput: { command: 'node' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
    });

    it('auto-grants .ai/scripts invocations via safeCommands prefix', () => {
      const policy = new DefaultPermissionPolicy({
        safeCommands: [
          'node --experimental-strip-types --experimental-detect-module ~/.ai/scripts',
        ],
      });
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          riskLevel: 'medium',
          toolInput: {
            command:
              'node --experimental-strip-types --experimental-detect-module ~/.ai/scripts/review-findings-writer.ts --review-report /tmp/report.json',
          },
        }),
        makeContext({ role: 'review_findings_writer' }),
      );
      expect(decision.action).toBe('grant');
    });
  });

  describe('decision reasons', () => {
    it('includes a reason in every decision', () => {
      const policy = new DefaultPermissionPolicy();
      const cases = [
        { request: makeRequest({ riskLevel: 'low' }), ctx: makeContext({ role: 'implementer' }) },
        { request: makeRequest({ riskLevel: 'high' }), ctx: makeContext({ role: 'implementer' }) },
        {
          request: makeRequest({ riskLevel: 'low' }),
          ctx: makeContext({ role: 'static_reviewer' }),
        },
        { request: makeRequest({ riskLevel: 'medium' }), ctx: makeContext({ role: 'verifier' }) },
      ];
      for (const { request, ctx } of cases) {
        const decision = policy.evaluate(request, ctx);
        expect(decision.reason).toBeTruthy();
      }
    });
  });

  describe('approval store integration', () => {
    it('grants when approval store has a matching entry', () => {
      const approvalStore = {
        findMatch: (action: string, resource: string) =>
          action === 'shell_execute' && resource.startsWith('npm test')
            ? { id: 'approval-1', action, resource: 'npm test', createdAt: '2026-01-01T00:00:00Z' }
            : undefined,
        record: () => Promise.resolve(),
        list: () => [],
        remove: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        reload: () => Promise.resolve(),
      };
      const policy = new DefaultPermissionPolicy(undefined, approvalStore);
      const decision = policy.evaluate(
        makeRequest({ action: 'shell_execute', resource: 'npm test -- --coverage' }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('grant');
      expect(decision.reason).toContain('previously_approved');
    });

    it('falls through to normal flow when no approval match', () => {
      const approvalStore = {
        findMatch: () => undefined,
        record: () => Promise.resolve(),
        list: () => [],
        remove: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        reload: () => Promise.resolve(),
      };
      const policy = new DefaultPermissionPolicy({ defaultAction: 'ask_human' }, approvalStore);
      const decision = policy.evaluate(
        makeRequest({
          action: 'shell_execute',
          resource: 'rm -rf /',
          riskLevel: 'high',
          toolInput: { command: 'rm -rf /' },
        }),
        makeContext({ role: 'verifier' }),
      );
      expect(decision.action).toBe('ask_human');
    });

    it('deny rules take precedence over approval store', () => {
      const approvalStore = {
        findMatch: () => ({ id: 'x', action: 'file_write', resource: 'src/', createdAt: '' }),
        record: () => Promise.resolve(),
        list: () => [],
        remove: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        reload: () => Promise.resolve(),
      };
      const policy = new DefaultPermissionPolicy(
        {
          defaultAction: 'ask_human',
          rules: [{ action: 'file_write', decision: 'deny', scope: 'src/**' }],
        },
        approvalStore,
      );
      const decision = policy.evaluate(
        makeRequest({ action: 'file_write', resource: 'src/main.ts' }),
        makeContext(),
      );
      expect(decision.action).toBe('deny');
    });
  });

  describe('read-only operations auto-grant', () => {
    const reviewerCtx = makeContext({ role: 'static_reviewer' });

    describe('file_read actions', () => {
      it('auto-grants file_read for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'file_read',
            resource: 'src/main.ts',
            detail: 'Read: src/main.ts',
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
        expect(decision.reason).toContain('read-only');
      });
    });

    describe('read-only tools', () => {
      it.each(['Read', 'Glob', 'Grep', 'LS', 'ListDir', 'SearchFiles', 'WebFetch', 'WebSearch'])(
        'auto-grants %s tool for no-trust roles',
        (toolName) => {
          const policy = new DefaultPermissionPolicy();
          const decision = policy.evaluate(
            makeRequest({ action: 'custom', detail: `${toolName}: some-resource` }),
            reviewerCtx,
          );
          expect(decision.action).toBe('grant');
          expect(decision.reason).toContain('read-only');
        },
      );

      it('does not auto-grant Write tool for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({ action: 'file_write', detail: 'Write: src/main.ts' }),
          reviewerCtx,
        );
        expect(decision.action).not.toBe('grant');
      });

      it('does not auto-grant Edit tool for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({ action: 'file_write', detail: 'Edit: src/main.ts' }),
          reviewerCtx,
        );
        expect(decision.action).not.toBe('grant');
      });
    });

    describe('read-only gh commands', () => {
      it.each([
        'gh pr view 123',
        'gh pr view 123 --json baseRefName,headRefName,url',
        'gh pr diff 42',
        'gh pr diff 42 --name-only',
        'gh pr list',
        'gh pr list --state open --json number,title',
        'gh pr checks 123',
        'gh pr status',
        'gh issue view 456',
        'gh issue list --label bug',
        'gh repo view',
        'gh auth status',
      ])('auto-grants "%s" for no-trust roles', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
        expect(decision.reason).toContain('read-only');
      });

      it.each([
        'gh pr merge 123',
        'gh pr close 123',
        'gh pr comment 123 --body "LGTM"',
        'gh pr edit 123 --title "new title"',
        'gh pr review 123 --approve',
        'gh issue create --title "bug"',
        'gh issue close 456',
        'gh repo create my-repo',
        'gh api repos/owner/repo/issues -X POST',
      ])('denies "%s" for no-trust roles', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('deny');
      });
    });

    describe('read-only git commands', () => {
      it.each([
        'git diff origin/main...origin/feat',
        'git show origin/feat:src/main.ts',
        'git log --oneline -20',
        'git rev-parse --verify origin/feat',
        'git status',
        'git blame src/main.ts',
        'git ls-files',
        'git ls-tree HEAD',
        'git cat-file -p HEAD',
        'git rev-list HEAD..origin/main',
        'git merge-base main feat',
        'git describe --tags',
        'git shortlog -sn',
        'git fetch origin',
        'git reflog show HEAD',
      ])('auto-grants "%s" for no-trust roles', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
        expect(decision.reason).toContain('read-only');
      });

      it('auto-grants git with -C flag for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: 'git -C /repo diff origin/main...origin/feat',
            detail: 'Bash: git -C /repo diff origin/main...origin/feat',
            riskLevel: 'high',
            toolInput: { command: 'git -C /repo diff origin/main...origin/feat' },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
      });

      it('auto-grants git with --no-pager flag for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: 'git --no-pager log --oneline',
            detail: 'Bash: git --no-pager log --oneline',
            riskLevel: 'high',
            toolInput: { command: 'git --no-pager log --oneline' },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
      });

      it('auto-grants git with combined -C and --no-pager flags', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: 'git -C /repo --no-pager show origin/feat:src/main.ts',
            detail: 'Bash: git -C /repo --no-pager show origin/feat:src/main.ts',
            riskLevel: 'high',
            toolInput: { command: 'git -C /repo --no-pager show origin/feat:src/main.ts' },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
      });

      it.each([
        'git push origin main',
        'git commit -m "evil"',
        'git merge feat',
        'git rebase main',
        'git reset --hard HEAD~1',
        'git checkout -b new-branch',
        'git clean -fd',
        'git stash',
        'git add .',
        'git rm src/main.ts',
        'git tag v1.0.0',
        'git branch -d old-branch',
      ])('denies "%s" for no-trust roles', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('deny');
      });
    });

    describe('compound commands', () => {
      it.each([
        'cd /tmp/pr-review-abc && git fetch origin main --quiet 2>&1; git diff origin/main...HEAD --stat 2>&1',
        'cd /tmp/repo && git log --oneline -5',
        'git status; git diff --stat',
        'git fetch origin && git log origin/main..HEAD',
        'cd /tmp/repo && git remote -v 2>&1 | head -5; echo "---"; gh pr diff 179 --repo org/repo',
        'cd /tmp/repo && echo "--- log ---" && git log --oneline -1 HEAD && echo "--- branch ---" && git branch -a --contains HEAD && gh pr view 179 --repo org/repo --json number,title 2>&1',
      ])('auto-grants compound read-only command: "%s"', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('grant');
        expect(decision.reason).toContain('read-only');
      });

      it('handles long whitespace runs in compound commands', () => {
        const policy = new DefaultPermissionPolicy();
        const whitespace = ' '.repeat(100_000);
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: `git status${whitespace}&&${whitespace}git diff`,
            toolInput: { command: `git status${whitespace}&&${whitespace}git diff` },
          }),
          makeContext({ role: 'verifier' }),
        );

        expect(decision.action).toBe('grant');
        expect(decision.reason).toContain('read-only');
      });

      it.each([
        'cd /tmp/repo && git push origin main',
        'git diff --stat; git add .',
        'cd /tmp/repo && git commit -m "evil"',
        'echo "payload" > /etc/cron.d/backdoor',
        'cat /etc/passwd > /tmp/stolen',
        'cd /tmp && echo "data" > overwrite.txt; git log',
      ])('denies compound command with mutating segment: "%s"', (command) => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: command,
            detail: `Bash: ${command}`,
            riskLevel: 'high',
            toolInput: { command },
          }),
          reviewerCtx,
        );
        expect(decision.action).not.toBe('grant');
      });
    });

    describe('precedence', () => {
      it('deny rules take precedence over read-only auto-grant', () => {
        const policy = new DefaultPermissionPolicy({
          rules: [{ action: 'shell_execute', decision: 'deny', pattern: 'git diff*' }],
        });
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: 'git diff origin/main',
            detail: 'Bash: git diff origin/main',
            riskLevel: 'high',
            toolInput: { command: 'git diff origin/main' },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('deny');
      });

      it('does not auto-grant file_write even if detail says Read', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'file_write',
            detail: 'Write: src/main.ts',
            resource: 'src/main.ts',
          }),
          reviewerCtx,
        );
        expect(decision.action).not.toBe('grant');
      });

      it('does not auto-grant non-VCS shell commands for no-trust roles', () => {
        const policy = new DefaultPermissionPolicy();
        const decision = policy.evaluate(
          makeRequest({
            action: 'shell_execute',
            resource: 'curl https://evil.com',
            detail: 'Bash: curl https://evil.com',
            riskLevel: 'high',
            toolInput: { command: 'curl https://evil.com' },
          }),
          reviewerCtx,
        );
        expect(decision.action).toBe('deny');
      });
    });
  });
});
