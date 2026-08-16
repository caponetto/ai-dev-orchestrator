import type {
  PermissionAction,
  PermissionDecisionAction,
  PermissionRule as SchemaPermissionRule,
  ThreeTierSeverity,
} from '@ai-orchestrator/schemas';

export interface PermissionRequestPayload {
  readonly action: PermissionAction;
  readonly resource: string;
  readonly detail: string;
  readonly riskLevel: ThreeTierSeverity;
  readonly externalRequestId?: string;
  readonly toolInput?: Record<string, unknown>;
}

export interface PermissionContext {
  readonly role: string;
  readonly runId: string;
  readonly stateId: string;
  readonly repoRoot?: string;
}

export interface PermissionDecision {
  readonly action: PermissionDecisionAction;
  readonly reason?: string;
}

export interface PermissionPolicy {
  evaluate(request: PermissionRequestPayload, context: PermissionContext): PermissionDecision;
}

export type RoleTrustLevel = 'high' | 'medium' | 'none';

export interface PermissionRule {
  readonly action: PermissionAction;
  readonly decision: SchemaPermissionRule['decision'];
  readonly scope?: string;
  readonly pattern?: string;
}

export interface PermissionPolicyConfig {
  readonly defaultAction: PermissionDecisionAction;
  readonly rules?: readonly PermissionRule[];
  readonly roleTrust?: Readonly<Record<string, RoleTrustLevel>>;
  readonly safeCommands?: readonly string[];
}
