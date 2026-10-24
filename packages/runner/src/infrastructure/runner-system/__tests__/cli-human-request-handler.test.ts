import type { PermissionRequestMessage } from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage } from '@ai-dev-orchestrator/agent-protocol';
import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { CliHumanRequestHandler } from '../cli-human-request-handler';
import type { LiveRequestStore } from '../file-backed-live-request-store';

const task: AgentTask = {
  taskId: 'task',
  runId: 'run',
  stateId: 'WORK',
  role: 'planner',
  description: '',
  inputArtifacts: [],
  repoRoot: '/repo',
  runDir: '/run',
  outputArtifactPath: '/run/plan.json',
  constraints: { timeout: 1000, requiredOutputType: 'plan' },
};

const permission = (): PermissionRequestMessage =>
  createProtocolMessage('permission_request', {
    action: 'file_write',
    resource: '/repo/file',
    detail: 'Write file',
    riskLevel: 'high',
    externalRequestId: 'external',
  });

describe('CLI human request handling', () => {
  it('delivers an approved answer even if recording the reusable approval fails', async () => {
    const handler = new CliHumanRequestHandler();
    const request = permission();
    const record = vi.fn().mockRejectedValue(new Error('cannot save approval'));
    handler.setApprovalStore({
      record,
      findMatch: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      reload: vi.fn(),
    });
    handler.setLiveRequestStore({
      writeRequest: vi.fn(),
      writeResponse: vi.fn(),
      listPendingRequests: vi.fn(),
      cleanupResolved: vi.fn(),
      awaitResponse: vi.fn().mockResolvedValue({
        runId: 'run',
        messageId: request.messageId,
        respondedAt: '',
        payload: { granted: true },
      }),
    });
    const transport = { send: vi.fn(), writeRaw: vi.fn() };
    await handler.handlePermissionRequest(request, task, transport);
    expect(transport.send.mock.calls[0]?.[0] as unknown).toMatchObject({
      type: 'permission_response',
      payload: { granted: true },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ resource: '/repo/file', createdByRole: 'planner' }),
    );
  });
  it('uses the current policy for each request and preserves response identity', async () => {
    const handler = new CliHumanRequestHandler();
    const transport = { send: vi.fn(), writeRaw: vi.fn() };
    const request = permission();
    handler.setPermissionPolicy({ evaluate: () => ({ action: 'grant', reason: 'first policy' }) });
    await handler.handlePermissionRequest(request, task, transport);
    handler.setPermissionPolicy({
      evaluate: () => ({ action: 'deny', reason: 'replacement policy' }),
    });
    await handler.handlePermissionRequest(request, task, transport);
    const messages = transport.send.mock.calls.map(([message]) => message as unknown);
    expect(messages[0]).toMatchObject({
      replyTo: request.messageId,
      payload: { granted: true, externalRequestId: 'external' },
    });
    expect(messages[1]).toMatchObject({
      replyTo: request.messageId,
      payload: { granted: false, externalRequestId: 'external' },
    });
  });

  it('uses adapter translation for a default denial without requiring a concrete transport', async () => {
    const handler = new CliHumanRequestHandler({
      name: 'custom',
      command: 'agent',
      args: [],
      translateInput: () => 'denied',
    });
    const transport = { send: vi.fn(), writeRaw: vi.fn() };
    await handler.handlePermissionRequest(permission(), task, transport);
    expect(transport.writeRaw).toHaveBeenCalledWith('denied');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('resolves an expired clarification and sends an abort using the task timeout override', async () => {
    const handler = new CliHumanRequestHandler(undefined, 900);
    const writeRequest = vi.fn();
    const awaitResponse = vi.fn().mockResolvedValue(null);
    const writeResponse = vi.fn();
    const store: LiveRequestStore = {
      writeRequest,
      awaitResponse,
      writeResponse,
      listPendingRequests: vi.fn(),
      cleanupResolved: vi.fn(),
    };
    handler.setLiveRequestStore(store);
    const transport = { send: vi.fn(), writeRaw: vi.fn() };
    const request = createProtocolMessage('clarification_request', {
      question: 'Which branch?',
      context: '',
    });
    await handler.handleClarificationRequest(
      request,
      { ...task, agentConfig: { liveRequestTimeoutMs: 200 } },
      transport,
    );
    expect(awaitResponse).toHaveBeenCalledWith('run', request.messageId, 200);
    expect(writeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'clarification', messageId: request.messageId }),
    );
    expect(writeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { timedOut: true, aborted: true } }),
    );
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'abort' }));
  });
});
