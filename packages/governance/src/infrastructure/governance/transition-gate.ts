import type {
  AgreementGate,
  GovernanceEngine,
  IterationContractRegistry,
  Logger,
  PolicyEngine,
} from '@ai-dev-orchestrator/ports';
import { noopLogger } from '@ai-dev-orchestrator/ports';
import type {
  AgreementStatus,
  AgreementType,
  EscalationReason,
  GovernanceDecision,
  GovernanceOutcome,
  PolicyEvaluation,
  TransitionDecision,
  TransitionRequest,
} from '@ai-dev-orchestrator/schemas';

import type { OwnershipCheckResult } from '../../domain/governance/ownership-check-result';

import { DecisionRecorder } from './decision-recorder';
import { EscalationManager } from './escalation-manager';
import { IterationLimiter } from './iteration-limiter';
import type { OwnershipEnforcer } from './ownership-enforcer';
import { QualityGateChecker } from './quality-gate-checker';

const STAGE_AGREEMENT_TYPE: Readonly<Record<string, AgreementType>> = {
  IMPLEMENTATION: 'planning_agreement',
  VERIFICATION: 'implementation_agreement',
};

/** Optional dependencies for the DefaultGovernanceEngine. */
export interface GovernanceEngineOptions {
  readonly agreementGate?: AgreementGate;
  readonly policyEngine?: PolicyEngine;
  readonly ownershipEnforcer?: OwnershipEnforcer;
  readonly logger?: Logger;
}

/** Default governance engine implementing the transition gate pattern. */
export class DefaultGovernanceEngine implements GovernanceEngine {
  private readonly limiter: IterationLimiter;
  private readonly qualityChecker: QualityGateChecker;
  private readonly escalationManager: EscalationManager;
  private readonly recorder: DecisionRecorder;
  private readonly agreementGate: AgreementGate | null;
  private readonly policyEngine: PolicyEngine | null;
  private readonly ownershipEnforcer: OwnershipEnforcer | null;
  private readonly logger: Logger;
  private lastRunId = '';

  constructor(contractRegistry: IterationContractRegistry, options?: GovernanceEngineOptions) {
    this.limiter = new IterationLimiter(contractRegistry);
    this.qualityChecker = new QualityGateChecker();
    this.escalationManager = new EscalationManager();
    this.recorder = new DecisionRecorder();
    this.agreementGate = options?.agreementGate ?? null;
    this.policyEngine = options?.policyEngine ?? null;
    this.ownershipEnforcer = options?.ownershipEnforcer ?? null;
    this.logger = options?.logger ?? noopLogger;
  }

  /** @inheritdoc */
  evaluateTransition(request: TransitionRequest): TransitionDecision {
    this.lastRunId = request.runId;

    if (this.ownershipEnforcer && request.artifacts.length > 0) {
      const ownershipResult = this.checkOwnership(request);
      if (!ownershipResult.allowed) {
        return {
          allowed: false,
          reason: ownershipResult.reason,
          remediation: 'Assign artifact production to the correct role',
        };
      }
    }

    if (this.agreementGate) {
      const requiredAgreement = STAGE_AGREEMENT_TYPE[request.to] as AgreementType | undefined;
      if (requiredAgreement) {
        const result = this.agreementGate.check(requiredAgreement, request.runId);
        this.logger.debug(
          `[GovernanceEngine] agreement check: type=${requiredAgreement}, exists=${String(result.exists)}, valid=${String(result.valid)}, reason=${result.reason ?? 'none'}`,
        );
        if (!result.exists || !result.valid) {
          const reason = `Required ${requiredAgreement} not satisfied for transition to ${request.to}`;
          this.recorder.record({
            timestamp: new Date().toISOString(),
            runId: request.runId,
            transitionRequested: { from: request.from, to: request.to },
            policiesEvaluated: [
              { policy: 'agreement_gate', evaluated: true, result: 'fail', detail: reason },
            ],
            outcome: 'denied',
            reason,
            artifactsInspected: request.artifacts,
          });
          return {
            allowed: false,
            reason,
            remediation: `Ensure ${requiredAgreement} is generated before transitioning to ${request.to}`,
          };
        }
      }
    }

    const evaluations = this.policyEngine
      ? this.evaluateViaPolicyEngine(request)
      : this.evaluateViaInternalCheckers(request);

    const decision = this.synthesize(request, evaluations);

    this.recorder.record({
      timestamp: new Date().toISOString(),
      runId: request.runId,
      transitionRequested: { from: request.from, to: request.to },
      policiesEvaluated: evaluations,
      outcome: this.toOutcome(decision),
      reason: decision.reason,
      artifactsInspected: request.artifacts,
    });

    return decision;
  }

  /** @inheritdoc */
  checkAgreement(stageId: string): AgreementStatus {
    if (this.agreementGate) {
      const agreementType = STAGE_AGREEMENT_TYPE[stageId] as AgreementType | undefined;
      if (agreementType) {
        const result = this.agreementGate.check(agreementType, this.lastRunId);
        return {
          exists: result.exists,
          valid: result.valid,
          artifact: result.artifactRef,
          missingReason: result.reason,
        };
      }
    }

    return {
      exists: false,
      valid: false,
      missingReason: 'No agreement gate configured or no mapping for stage',
    };
  }

  /** @inheritdoc */
  recordDecision(decision: GovernanceDecision): void {
    this.recorder.record(decision);
  }

  private evaluateViaPolicyEngine(request: TransitionRequest): PolicyEvaluation[] {
    if (!this.policyEngine) {
      return [];
    }
    const policyDecision = this.policyEngine.evaluate({
      runId: request.runId,
      currentState: request.from,
      requestedTransition: { from: request.from, to: request.to },
      artifacts: request.artifacts,
      findings: request.findings?.map((f) => ({
        id: f.id,
        severity: f.severity,
        blocking: f.severity === 'high' ? 'must_fix' : 'should_fix',
        status: f.status,
      })),
      iterationCount: request.iterationCount,
      humanApproval: request.humanApproval,
      tokenUsage: request.tokenUsage,
    });

    return policyDecision.results.map((r) => ({
      policy: r.policyType,
      evaluated: true,
      result: r.outcome === 'pass' ? ('pass' as const) : ('fail' as const),
      detail: r.detail ?? r.reason,
      escalationTrigger: r.escalationTrigger,
    }));
  }

  private evaluateViaInternalCheckers(request: TransitionRequest): PolicyEvaluation[] {
    const evaluations: PolicyEvaluation[] = [];

    const iterationEval = this.limiter.evaluate(request.from, request.iterationCount ?? 0);
    evaluations.push(iterationEval);

    const qualityEval = this.qualityChecker.evaluate(request.findings ?? [], 0, 3);
    evaluations.push(qualityEval);

    return evaluations;
  }

  private synthesize(
    request: TransitionRequest,
    evaluations: readonly PolicyEvaluation[],
  ): TransitionDecision {
    const iterationFailed = evaluations.some(
      (e) => e.policy === 'iteration_limit' && e.result === 'fail',
    );

    if (iterationFailed) {
      const context = this.escalationManager.buildContext(
        request.runId,
        request.from,
        'iteration_limit_exceeded',
        request.findings ?? [],
        request.artifacts,
      );

      return {
        escalate: true,
        reason: 'Iteration limit exceeded',
        context,
      };
    }

    const budgetEscalation = evaluations.find((e) => e.result === 'fail' && e.escalationTrigger);
    if (budgetEscalation) {
      const trigger = budgetEscalation.escalationTrigger as EscalationReason;
      const context = this.escalationManager.buildContext(
        request.runId,
        request.from,
        trigger,
        request.findings ?? [],
        request.artifacts,
      );
      return {
        escalate: true,
        reason: budgetEscalation.detail,
        context,
      };
    }

    const failures = evaluations.filter((e) => e.result === 'fail');
    if (failures.length > 0) {
      const reasons = failures.map((f) => f.detail);
      return {
        allowed: false,
        reason: reasons.join('; '),
        remediation: failures.map((f) => `Fix: ${f.detail}`).join('; '),
      };
    }

    return {
      allowed: true,
      reason: 'All governance policies passed',
    };
  }

  private checkOwnership(request: TransitionRequest): OwnershipCheckResult {
    if (!this.ownershipEnforcer) {
      return { allowed: true, reason: 'No ownership enforcer configured' };
    }
    const roleId = request.from.toLowerCase().replace(/_/g, '-');
    return this.ownershipEnforcer.validateTransitionArtifacts(roleId, request.artifacts, true);
  }

  private toOutcome(decision: TransitionDecision): GovernanceOutcome {
    if ('escalate' in decision) {
      return 'escalated';
    }
    if (decision.allowed) {
      return 'allowed';
    }
    return 'denied';
  }
}
