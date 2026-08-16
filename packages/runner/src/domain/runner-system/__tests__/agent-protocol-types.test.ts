import {
  PROTOCOL_VERSION,
  KNOWN_CAPABILITIES,
  AGENT_TO_ORCHESTRATOR_TYPES,
  ORCHESTRATOR_TO_AGENT_TYPES,
  ALL_MESSAGE_TYPES,
  createProtocolMessage,
  resetMessageCounter,
} from '@ai-orchestrator/agent-protocol';
import type {
  ProtocolMessage,
  HandshakeMessage,
  HandshakeAckMessage,
  ProgressMessage,
  PermissionRequestMessage,
  PermissionResponseMessage,
  ClarificationRequestMessage,
  ClarificationResponseMessage,
  ArtifactMessage,
  LogMessage,
  DoneMessage,
  ErrorMessage,
  AbortMessage,
  AgentToOrchestratorMessage,
  OrchestratorToAgentMessage,
} from '@ai-orchestrator/agent-protocol';
import type { PermissionAction } from '@ai-orchestrator/schemas';
import { describe, expect, it, beforeEach } from 'vitest';

describe('agent-protocol-types', () => {
  beforeEach(() => {
    resetMessageCounter();
  });

  describe('PROTOCOL_VERSION', () => {
    it('is ado/agent/v1', () => {
      expect(PROTOCOL_VERSION).toBe('ado/agent/v1');
    });
  });

  describe('KNOWN_CAPABILITIES', () => {
    it('contains the four expected capabilities', () => {
      expect(KNOWN_CAPABILITIES).toEqual([
        'permission_request',
        'clarification_request',
        'streaming_artifact',
        'structured_log',
      ]);
    });
  });

  describe('message type arrays', () => {
    it('AGENT_TO_ORCHESTRATOR_TYPES has 8 types', () => {
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toHaveLength(8);
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('handshake');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('progress');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('permission_request');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('clarification_request');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('artifact');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('log');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('done');
      expect(AGENT_TO_ORCHESTRATOR_TYPES).toContain('error');
    });

    it('ORCHESTRATOR_TO_AGENT_TYPES has 4 types', () => {
      expect(ORCHESTRATOR_TO_AGENT_TYPES).toHaveLength(4);
      expect(ORCHESTRATOR_TO_AGENT_TYPES).toContain('handshake_ack');
      expect(ORCHESTRATOR_TO_AGENT_TYPES).toContain('permission_response');
      expect(ORCHESTRATOR_TO_AGENT_TYPES).toContain('clarification_response');
      expect(ORCHESTRATOR_TO_AGENT_TYPES).toContain('abort');
    });

    it('ALL_MESSAGE_TYPES is the union of both arrays', () => {
      expect(ALL_MESSAGE_TYPES).toHaveLength(12);
      for (const t of AGENT_TO_ORCHESTRATOR_TYPES) {
        expect(ALL_MESSAGE_TYPES).toContain(t);
      }
      for (const t of ORCHESTRATOR_TO_AGENT_TYPES) {
        expect(ALL_MESSAGE_TYPES).toContain(t);
      }
    });
  });

  describe('createProtocolMessage', () => {
    it('creates a message with envelope fields', () => {
      const msg = createProtocolMessage('handshake', {
        capabilities: ['permission_request'],
      });

      expect(msg.protocol).toBe(PROTOCOL_VERSION);
      expect(msg.messageId).toMatch(/^msg-/);
      expect(msg.timestamp).toBeTruthy();
      expect(msg.type).toBe('handshake');
      expect(msg.payload.capabilities).toEqual(['permission_request']);
      expect(msg.replyTo).toBeUndefined();
    });

    it('includes replyTo when provided', () => {
      const msg = createProtocolMessage(
        'permission_response',
        { granted: true },
        'original-msg-id',
      );

      expect(msg.replyTo).toBe('original-msg-id');
    });

    it('generates unique message IDs', () => {
      const msg1 = createProtocolMessage('progress', { phase: 'a', detail: 'b' });
      const msg2 = createProtocolMessage('progress', { phase: 'c', detail: 'd' });

      expect(msg1.messageId).not.toBe(msg2.messageId);
    });
  });

  describe('type construction', () => {
    it('constructs a HandshakeMessage', () => {
      const msg: HandshakeMessage = createProtocolMessage('handshake', {
        capabilities: ['permission_request', 'clarification_request'],
      });
      expect(msg.type).toBe('handshake');
      expect(msg.payload.capabilities).toHaveLength(2);
    });

    it('constructs a HandshakeAckMessage', () => {
      const msg: HandshakeAckMessage = createProtocolMessage('handshake_ack', {
        sessionId: 'sess-1',
        permissionHints: ['file_write', 'shell_execute'] as const,
      });
      expect(msg.payload.sessionId).toBe('sess-1');
      expect(msg.payload.permissionHints).toHaveLength(2);
    });

    it('constructs a ProgressMessage', () => {
      const msg: ProgressMessage = createProtocolMessage('progress', {
        phase: 'implementation',
        detail: 'Writing code',
        percent: 50,
      });
      expect(msg.payload.percent).toBe(50);
    });

    it('constructs a PermissionRequestMessage', () => {
      const msg: PermissionRequestMessage = createProtocolMessage('permission_request', {
        action: 'file_write',
        resource: 'src/main.ts',
        detail: 'Write implementation',
        riskLevel: 'medium' as const,
      });
      expect(msg.payload.action).toBe('file_write');
      expect(msg.payload.riskLevel).toBe('medium');
    });

    it('constructs a PermissionResponseMessage', () => {
      const msg: PermissionResponseMessage = createProtocolMessage(
        'permission_response',
        { granted: false, reason: 'Denied by policy' },
        'req-1',
      );
      expect(msg.payload.granted).toBe(false);
      expect(msg.replyTo).toBe('req-1');
    });

    it('constructs a ClarificationRequestMessage', () => {
      const msg: ClarificationRequestMessage = createProtocolMessage('clarification_request', {
        question: 'Which auth method?',
        context: 'Multiple options available',
        options: ['OAuth', 'JWT'],
      });
      expect(msg.payload.options).toEqual(['OAuth', 'JWT']);
    });

    it('constructs a ClarificationResponseMessage', () => {
      const msg: ClarificationResponseMessage = createProtocolMessage(
        'clarification_response',
        { answer: 'Use OAuth' },
        'req-2',
      );
      expect(msg.payload.answer).toBe('Use OAuth');
    });

    it('constructs an ArtifactMessage', () => {
      const msg: ArtifactMessage = createProtocolMessage('artifact', {
        artifactType: 'code',
        content: 'console.log("hi")',
        isFinal: true,
      });
      expect(msg.payload.isFinal).toBe(true);
    });

    it('constructs a LogMessage', () => {
      const msg: LogMessage = createProtocolMessage('log', {
        level: 'warn' as const,
        message: 'Deprecation warning',
      });
      expect(msg.payload.level).toBe('warn');
    });

    it('constructs a DoneMessage', () => {
      const msg: DoneMessage = createProtocolMessage('done', {
        summary: 'Task completed successfully',
      });
      expect(msg.payload.summary).toBeTruthy();
    });

    it('constructs an ErrorMessage', () => {
      const msg: ErrorMessage = createProtocolMessage('error', {
        code: 'TIMEOUT',
        message: 'Operation timed out',
        recoverable: false,
      });
      expect(msg.payload.recoverable).toBe(false);
    });

    it('constructs an AbortMessage', () => {
      const msg: AbortMessage = createProtocolMessage('abort', {
        reason: 'User cancelled',
      });
      expect(msg.payload.reason).toBe('User cancelled');
    });
  });

  describe('type exhaustiveness', () => {
    it('all AgentToOrchestratorType values are constructable', () => {
      const messages: AgentToOrchestratorMessage[] = [
        createProtocolMessage('handshake', { capabilities: [] }),
        createProtocolMessage('progress', { phase: '', detail: '' }),
        createProtocolMessage('permission_request', {
          action: 'file_read' as const,
          resource: '',
          detail: '',
          riskLevel: 'low' as const,
        }),
        createProtocolMessage('clarification_request', { question: '', context: '' }),
        createProtocolMessage('artifact', { artifactType: '', content: '', isFinal: false }),
        createProtocolMessage('log', { level: 'info' as const, message: '' }),
        createProtocolMessage('done', { summary: '' }),
        createProtocolMessage('error', { code: '', message: '', recoverable: true }),
      ];
      expect(messages).toHaveLength(8);
    });

    it('all OrchestratorToAgentType values are constructable', () => {
      const messages: OrchestratorToAgentMessage[] = [
        createProtocolMessage('handshake_ack', { sessionId: '' }),
        createProtocolMessage('permission_response', { granted: true }),
        createProtocolMessage('clarification_response', { answer: '' }),
        createProtocolMessage('abort', { reason: '' }),
      ];
      expect(messages).toHaveLength(4);
    });

    it('PermissionAction covers all expected values', () => {
      const actions: PermissionAction[] = [
        'file_read',
        'file_write',
        'file_delete',
        'shell_execute',
        'network_request',
        'git_operation',
        'custom',
      ];
      expect(actions).toHaveLength(7);
    });
  });

  describe('ProtocolMessage generic', () => {
    it('accepts typed payloads', () => {
      const msg: ProtocolMessage<'done', { summary: string }> = createProtocolMessage('done', {
        summary: 'ok',
      });
      expect(msg.type).toBe('done');
      expect(msg.payload.summary).toBe('ok');
    });
  });
});
