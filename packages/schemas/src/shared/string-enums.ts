import { z } from 'zod/v4';

export const threeTierSeveritySchema = z.enum(['high', 'medium', 'low']);
export type ThreeTierSeverity = z.infer<typeof threeTierSeveritySchema>;

export const sessionTransportSchema = z.enum(['stdio', 'remote']);
export type SessionTransport = z.infer<typeof sessionTransportSchema>;

export const liveRequestKindSchema = z.enum(['permission', 'clarification']);
export type LiveRequestKind = z.infer<typeof liveRequestKindSchema>;

export const readinessVerdictSchema = z.enum(['Ready', 'NotReady']);
export type ReadinessVerdict = z.infer<typeof readinessVerdictSchema>;

export const outputFormatSchema = z.enum(['markdown_with_frontmatter', 'yaml', 'json', 'freeform']);
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const agentStreamEventTypeSchema = z.enum([
  'stdout',
  'stderr',
  'status',
  'permission_request',
  'clarification_request',
]);
export type AgentStreamEventType = z.infer<typeof agentStreamEventTypeSchema>;

export const roleTrustLevelSchema = z.enum(['high', 'medium', 'none']);
export type RoleTrustLevel = z.infer<typeof roleTrustLevelSchema>;

export const permissionActionSchema = z.enum([
  'file_read',
  'file_write',
  'file_delete',
  'shell_execute',
  'network_request',
  'git_operation',
  'custom',
]);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const permissionDecisionActionSchema = z.enum(['grant', 'deny', 'ask_human']);
export type PermissionDecisionAction = z.infer<typeof permissionDecisionActionSchema>;
