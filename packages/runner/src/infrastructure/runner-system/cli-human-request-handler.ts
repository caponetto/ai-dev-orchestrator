import type { AgentAdapter } from '@ai-dev-orchestrator/agent-adapters';
import type {
  ClarificationRequestMessage,
  PermissionRequestMessage,
  ProtocolMessage,
} from '@ai-dev-orchestrator/agent-protocol';
import { createProtocolMessage, payloadToRecord } from '@ai-dev-orchestrator/agent-protocol';
import type {
  AgentOutputStreamEvent,
  PermissionContext,
  PermissionPolicy,
} from '@ai-dev-orchestrator/ports';
import type { AgentTask } from '@ai-dev-orchestrator/schemas';
import {
  liveClarificationResponsePayloadSchema,
  livePermissionResponsePayloadSchema,
} from '@ai-dev-orchestrator/schemas';

import type { LiveRequestStore } from './file-backed-live-request-store';
import type { PermissionApprovalStore } from './permission-approval-store';
import type { StdioProtocolTransport } from './stdio-protocol-transport';

const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 300_000;

/** Routes one runner's human requests; owns policy/store configuration, not subprocess state. */
export class CliHumanRequestHandler {
  private permissionPolicy?: PermissionPolicy;
  private liveRequestStore?: LiveRequestStore;
  private approvalStore?: PermissionApprovalStore;

  constructor(
    private readonly adapter?: AgentAdapter,
    private readonly liveRequestTimeoutMs?: number,
  ) {}

  setPermissionPolicy(policy: PermissionPolicy): void {
    this.permissionPolicy = policy;
  }
  setLiveRequestStore(store: LiveRequestStore): void {
    this.liveRequestStore = store;
  }
  setApprovalStore(store: PermissionApprovalStore): void {
    this.approvalStore = store;
  }

  private sendToAgent(
    message: ProtocolMessage,
    transport: Pick<StdioProtocolTransport, 'send' | 'writeRaw'>,
  ): void {
    const adapter = this.adapter;
    if (adapter?.translateInput) {
      const translated = adapter.translateInput(message);
      if (translated !== null) {
        transport.writeRaw(translated);
        return;
      }
    }
    transport.send(message);
  }

  async handlePermissionRequest(
    message: PermissionRequestMessage,
    task: AgentTask,
    transport: Pick<StdioProtocolTransport, 'send' | 'writeRaw'>,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    if (this.permissionPolicy) {
      const context: PermissionContext = {
        role: task.role,
        runId: task.runId,
        stateId: task.stateId,
        repoRoot: task.repoRoot,
      };
      const decision = this.permissionPolicy.evaluate(payload, context);

      if (decision.action === 'grant') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission auto-granted: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'granted',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted: true,
              reason: decision.reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        return;
      }

      if (decision.action === 'deny') {
        onStreamEvent?.({
          timestamp: message.timestamp,
          type: 'permission_request',
          content: `Permission denied: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_resolved',
            resolved: 'denied',
            reason: decision.reason,
            ...payloadToRecord(payload),
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted: false,
              reason: decision.reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        return;
      }
    }

    // ask_human path: emit interactive banner and wait for human response
    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'permission_request',
      content: `Permission request: ${payload.action} ${payload.resource} (${payload.riskLevel} risk)`,
      structuredData: {
        messageType: 'permission_request',
        ...payloadToRecord(payload),
      },
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveRequestTimeoutMs =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;

      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'permission',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveRequestTimeoutMs).toISOString(),
        payload: payloadToRecord(payload),
      });

      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveRequestTimeoutMs,
      );

      if (response) {
        const permPayload = livePermissionResponsePayloadSchema.safeParse(response.payload);
        const granted = permPayload.success && permPayload.data.granted === true;
        const reason = permPayload.success ? permPayload.data.reason : undefined;
        onStreamEvent?.({
          timestamp: new Date().toISOString(),
          type: 'permission_request',
          content: `Permission ${granted ? 'granted' : 'denied'}: ${payload.action} ${payload.resource}`,
          structuredData: {
            messageType: 'permission_response',
            granted,
            reason,
            action: payload.action,
          },
          requestMessageId: message.messageId,
        });
        this.sendToAgent(
          createProtocolMessage(
            'permission_response',
            {
              granted,
              reason,
              externalRequestId: payload.externalRequestId,
              toolInput: payload.toolInput,
            },
            message.messageId,
          ),
          transport,
        );
        if (granted && this.approvalStore) {
          this.approvalStore
            .record({
              action: payload.action,
              resource: payload.resource,
              detail: payload.detail,
              createdByRole: task.role,
            })
            .catch(() => {});
        }
      } else {
        try {
          await this.liveRequestStore.writeResponse({
            runId: task.runId,
            messageId: message.messageId,
            respondedAt: new Date().toISOString(),
            payload: { timedOut: true, granted: false },
          });
        } finally {
          this.sendToAgent(
            createProtocolMessage(
              'permission_response',
              {
                granted: false,
                reason: 'Live request timed out — denied by default',
                externalRequestId: payload.externalRequestId,
                toolInput: payload.toolInput,
              },
              message.messageId,
            ),
            transport,
          );
        }
      }
      return;
    }

    // No policy and no live request store: deny by default
    this.sendToAgent(
      createProtocolMessage(
        'permission_response',
        {
          granted: false,
          reason: 'No permission policy configured',
          externalRequestId: payload.externalRequestId,
          toolInput: payload.toolInput,
        },
        message.messageId,
      ),
      transport,
    );
  }

  async handleClarificationRequest(
    message: ClarificationRequestMessage,
    task: AgentTask,
    transport: Pick<StdioProtocolTransport, 'send' | 'writeRaw'>,
    onStreamEvent?: (event: AgentOutputStreamEvent) => void,
  ): Promise<void> {
    const payload = message.payload;

    onStreamEvent?.({
      timestamp: message.timestamp,
      type: 'clarification_request',
      content: `Clarification needed: ${payload.question}`,
      structuredData: payloadToRecord(payload),
      requestMessageId: message.messageId,
    });

    if (this.liveRequestStore) {
      const liveRequestTimeoutMs =
        task.agentConfig?.['liveRequestTimeoutMs'] ??
        this.liveRequestTimeoutMs ??
        DEFAULT_LIVE_REQUEST_TIMEOUT_MS;

      const now = new Date();
      await this.liveRequestStore.writeRequest({
        runId: task.runId,
        messageId: message.messageId,
        kind: 'clarification',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + liveRequestTimeoutMs).toISOString(),
        payload: payloadToRecord(payload),
      });

      const response = await this.liveRequestStore.awaitResponse(
        task.runId,
        message.messageId,
        liveRequestTimeoutMs,
      );

      if (response) {
        const clarPayload = liveClarificationResponsePayloadSchema.safeParse(response.payload);
        const answer = clarPayload.success ? (clarPayload.data.answer ?? '') : '';
        this.sendToAgent(
          createProtocolMessage('clarification_response', { answer }, message.messageId),
          transport,
        );
      } else {
        // v1: timeout → abort (do NOT transition to WAITING_FOR_HUMAN)
        try {
          await this.liveRequestStore.writeResponse({
            runId: task.runId,
            messageId: message.messageId,
            respondedAt: new Date().toISOString(),
            payload: { timedOut: true, aborted: true },
          });
        } finally {
          this.sendToAgent(
            createProtocolMessage('abort', { reason: 'Clarification request timed out' }),
            transport,
          );
        }
      }
      return;
    }

    // No live request store: abort
    this.sendToAgent(
      createProtocolMessage('abort', {
        reason: 'No live request store configured for clarification',
      }),
      transport,
    );
  }
}
