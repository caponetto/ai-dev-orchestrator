import { validatePlanStructure, parseTypedArtifactContent } from '@ai-orchestrator/artifacts';
import type {
  ArtifactStore,
  IterationContractRegistry,
  Logger,
  ProjectContextStore,
} from '@ai-orchestrator/ports';
import { noopLogger } from '@ai-orchestrator/ports';
import type {
  ConfidenceReport,
  Guard,
  GuardResult,
  TransitionContext,
} from '@ai-orchestrator/schemas';

import {
  evaluateKnownFailurePatternGuard,
  evaluatePreviousRunPatternGuard,
} from './context-guards';
import {
  approvedGuardContentSchema,
  judgeGuardContentSchema,
  passedGuardContentSchema,
  planGuardContentSchema,
  reviewGuardContentSchema,
  specClarificationGuardContentSchema,
  specFeasibilityGuardContentSchema,
  triageNeedsHumanGuardContentSchema,
  triagePlanIssueGuardContentSchema,
  verificationFailuresGuardContentSchema,
  verificationPassedGuardContentSchema,
} from './guard-content-schemas';
import { resolveCanonicalSpecification } from './resolve-canonical-specification';

/** Evaluates structural guards for transitions. */
export class GuardChecker {
  private readonly artifactStore: ArtifactStore;
  private readonly contractRegistry: IterationContractRegistry;
  private readonly logger: Logger;
  private readonly contextStore: ProjectContextStore | null;
  private lastConfidenceReport: ConfidenceReport | null = null;

  constructor(
    artifactStore: ArtifactStore,
    contractRegistry: IterationContractRegistry,
    logger?: Logger,
    contextStore?: ProjectContextStore,
  ) {
    this.artifactStore = artifactStore;
    this.contractRegistry = contractRegistry;
    this.logger = logger ?? noopLogger;
    this.contextStore = contextStore ?? null;
  }

  setLastConfidenceReport(report: ConfidenceReport | null): void {
    this.lastConfidenceReport = report;
  }

  /** Evaluate all guards for a transition. */
  async evaluateAll(
    guards: readonly Guard[],
    context: TransitionContext,
  ): Promise<readonly GuardResult[]> {
    const results: GuardResult[] = [];
    for (const guard of guards) {
      const result = await this.evaluate(guard, context);
      results.push(result);
    }
    return results;
  }

  /** Check whether all guards pass. */
  async allPass(guards: readonly Guard[], context: TransitionContext): Promise<boolean> {
    const results = await this.evaluateAll(guards, context);
    return results.every((r) => r.passed);
  }

  private async evaluate(guard: Guard, context: TransitionContext): Promise<GuardResult> {
    switch (guard.type) {
      case 'artifact_exists':
        return this.checkArtifactExists(guard);
      case 'artifact_version_min':
        return this.checkArtifactVersionMin(guard);
      case 'agreement_exists':
        return this.checkAgreementExists(guard);
      case 'state_visited':
        return this.checkStateVisited(guard, context);
      case 'iteration_below_limit':
        return this.checkIterationBelowLimit(guard);
      case 'findings_indicate_plan_issue':
        return this.checkFindingsIndicatePlanIssue(guard, context);
      case 'known_failure_pattern':
        return this.checkContextGuard(guard);
      case 'verification_failures_are_fixable':
        return this.checkVerificationFailuresAreFixable(guard);
      case 'verification_passed':
        return this.checkVerificationPassed(guard);
      case 'waiting_context_matches':
        return this.checkWaitingContextMatches(guard, context);
      case 'plan_structure_valid':
        return this.checkPlanStructureValid(guard);
      case 'previous_run_pattern':
        return this.checkContextGuard(guard);
      case 'specification_feasible':
        return this.checkSpecificationFeasible(guard);
      case 'has_clarification_needs':
        return this.checkHasClarificationNeeds(guard);
      case 'synthesis_approved':
        return this.checkSynthesisApproved(guard);
      case 'acceptance_passed':
        return this.checkAcceptancePassed(guard);
      case 'triage_indicates_plan_issue':
        return this.checkTriageIndicatesPlanIssue(guard);
      case 'triage_needs_human':
        return this.checkTriageNeedsHuman(guard);
      case 'confidence_threshold':
        return this.checkConfidenceThreshold(guard);
      case 'project_context_available':
        return this.checkProjectContextAvailable(guard);
      default:
        throw new Error(`Unhandled guard: ${(guard as Guard).type}`);
    }
  }

  private async checkArtifactExists(
    guard: Extract<Guard, { type: 'artifact_exists' }>,
  ): Promise<GuardResult> {
    const artifactType = guard.params.artifactType;
    const direct = await this.artifactStore.getLatest(artifactType, artifactType);
    if (direct) {
      return { guard, passed: true, detail: `Artifact "${artifactType}" exists` };
    }
    const matches = await this.artifactStore.list({ type: artifactType });
    return {
      guard,
      passed: matches.length > 0,
      detail:
        matches.length > 0
          ? `Artifact "${artifactType}" exists`
          : `Artifact "${artifactType}" not found`,
    };
  }

  private async checkArtifactVersionMin(
    guard: Extract<Guard, { type: 'artifact_version_min' }>,
  ): Promise<GuardResult> {
    const artifactType = guard.params.artifactType;
    const minVersion = guard.params.minVersion;
    const artifact = await this.artifactStore.getLatest(artifactType, artifactType);
    if (!artifact) {
      return { guard, passed: false, detail: `Artifact "${artifactType}" not found` };
    }
    const passed = artifact.version >= minVersion;
    return {
      guard,
      passed,
      detail: passed
        ? `Artifact "${artifactType}" at version ${String(artifact.version)} >= ${String(minVersion)}`
        : `Artifact "${artifactType}" at version ${String(artifact.version)} < ${String(minVersion)}`,
    };
  }

  private async checkAgreementExists(
    guard: Extract<Guard, { type: 'agreement_exists' }>,
  ): Promise<GuardResult> {
    const agreementType = guard.params.agreementType;
    const artifact = await this.artifactStore.getLatest(agreementType, agreementType);
    return {
      guard,
      passed: artifact !== null,
      detail:
        artifact === null
          ? `Agreement "${agreementType}" not found`
          : `Agreement "${agreementType}" exists`,
    };
  }

  private checkStateVisited(
    guard: Extract<Guard, { type: 'state_visited' }>,
    context: TransitionContext,
  ): GuardResult {
    const stateId = guard.params.stateId;
    const visited = context.stateHistory.includes(stateId);
    return {
      guard,
      passed: visited,
      detail: visited
        ? `State "${stateId}" has been visited`
        : `State "${stateId}" has not been visited`,
    };
  }

  private checkIterationBelowLimit(
    guard: Extract<Guard, { type: 'iteration_below_limit' }>,
  ): GuardResult {
    const contractId = guard.params.contract;
    const contract = this.contractRegistry.getContract(contractId);
    if (!contract) {
      return { guard, passed: true, detail: `No contract "${contractId}" found, allowing` };
    }
    const iterState = this.contractRegistry.getIterationState(contract.id);
    const belowLimit = iterState.currentIteration < contract.maxIterations;
    return {
      guard,
      passed: belowLimit,
      detail: belowLimit
        ? `Iteration ${String(iterState.currentIteration)} < ${String(contract.maxIterations)} for "${contractId}"`
        : `Iteration ${String(iterState.currentIteration)} >= ${String(contract.maxIterations)} for "${contractId}" — limit reached`,
    };
  }

  private async checkFindingsIndicatePlanIssue(
    guard: Extract<Guard, { type: 'findings_indicate_plan_issue' }>,
    context: TransitionContext,
  ): Promise<GuardResult> {
    const refs = context.artifactRefs ?? [];
    for (const ref of refs) {
      try {
        const artifact = await this.artifactStore.get(ref);

        const judge = parseTypedArtifactContent(artifact.content, judgeGuardContentSchema);
        if (judge?.planLevelIssue === true) {
          return {
            guard,
            passed: true,
            detail: 'Judge decision indicates plan-level issue',
          };
        }

        const review = parseTypedArtifactContent(artifact.content, reviewGuardContentSchema);
        if (review?.findings) {
          const hasPlanIssue = review.findings.some(
            (finding) =>
              finding.category === 'plan' ||
              finding.severity === 'architectural' ||
              (finding.category === 'design' && finding.severity === 'critical'),
          );
          if (hasPlanIssue) {
            return {
              guard,
              passed: true,
              detail: 'Review findings indicate plan-level issues',
            };
          }
        }
      } catch (err: unknown) {
        this.logger.debug(
          `[GuardChecker] Failed to read artifact for plan-issue check: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return {
      guard,
      passed: false,
      detail: 'No plan-level findings detected in review artifacts',
    };
  }

  private async checkVerificationFailuresAreFixable(
    guard: Extract<Guard, { type: 'verification_failures_are_fixable' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'verification' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No verification artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(
        artifact.content,
        verificationFailuresGuardContentSchema,
      );
      if (parsed) {
        const allFixable = parsed.failures.length > 0 && parsed.failures.every((f) => f.fixable);
        return {
          guard,
          passed: allFixable,
          detail: allFixable
            ? 'All verification failures are fixable'
            : 'Some verification failures are not fixable',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] verification_failures_are_fixable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { guard, passed: false, detail: 'Verification artifact has no parseable failures' };
  }

  private async checkVerificationPassed(
    guard: Extract<Guard, { type: 'verification_passed' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'verification' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No verification artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(
        artifact.content,
        verificationPassedGuardContentSchema,
      );
      if (parsed) {
        return {
          guard,
          passed: parsed.passed,
          detail: parsed.passed
            ? 'Verification passed'
            : 'Verification failed — artifact reports passed=false',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] verification_passed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { guard, passed: false, detail: 'Verification artifact has no parseable passed field' };
  }

  private checkWaitingContextMatches(
    guard: Extract<Guard, { type: 'waiting_context_matches' }>,
    context: TransitionContext,
  ): GuardResult {
    const expectedState = guard.params.requestingState;
    const match = context.waitingContext?.requestingState === expectedState;
    return {
      guard,
      passed: match,
      detail: match
        ? `Waiting context matches "${expectedState}"`
        : `Waiting context "${context.waitingContext?.requestingState ?? 'none'}" does not match "${expectedState}"`,
    };
  }

  private async checkPlanStructureValid(
    guard: Extract<Guard, { type: 'plan_structure_valid' }>,
  ): Promise<GuardResult> {
    let artifact = await this.artifactStore.getLatest('plan', 'plan');
    if (!artifact) {
      const refs = await this.artifactStore.list({ type: 'plan' });
      if (refs.length > 0) {
        try {
          artifact = await this.artifactStore.get(refs[refs.length - 1]);
        } catch (err: unknown) {
          this.logger.debug(
            `[GuardChecker] plan_structure_valid: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (!artifact) {
      return {
        guard,
        passed: true,
        detail: 'No plan artifact resolved — structure check deferred to artifact_exists guard',
      };
    }
    const parsed = parseTypedArtifactContent(artifact.content, planGuardContentSchema);
    if (!parsed) {
      return {
        guard,
        passed: true,
        detail: 'Plan content is not structured data — DAG validation skipped',
      };
    }
    const errors = validatePlanStructure(parsed);
    if (errors.length > 0) {
      return { guard, passed: false, detail: `Plan structure invalid: ${errors.join('; ')}` };
    }
    return { guard, passed: true, detail: 'Plan structure is valid' };
  }

  private async checkHasClarificationNeeds(
    guard: Extract<Guard, { type: 'has_clarification_needs' }>,
  ): Promise<GuardResult> {
    const artifact = await resolveCanonicalSpecification(this.artifactStore);
    if (!artifact) {
      return {
        guard,
        passed: false,
        detail: 'No canonical_specification found — cannot check clarification needs',
      };
    }
    try {
      const parsed = parseTypedArtifactContent(
        artifact.content,
        specClarificationGuardContentSchema,
      );
      if (!parsed) {
        return { guard, passed: false, detail: 'No clarificationNeeds field — treating as none' };
      }
      const needs = parsed.clarificationNeeds;
      const hasNeeds = Array.isArray(needs) && needs.length > 0;
      return {
        guard,
        passed: hasNeeds,
        detail: hasNeeds
          ? `Specification has ${String(needs.length)} clarification need(s)`
          : 'Specification has no clarification needs',
      };
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] has_clarification_needs: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        guard,
        passed: false,
        detail: 'Failed to parse specification — treating as no clarification needs',
      };
    }
  }

  private async checkSynthesisApproved(
    guard: Extract<Guard, { type: 'synthesis_approved' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'review_report' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No review_report artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(artifact.content, approvedGuardContentSchema);
      if (parsed) {
        return {
          guard,
          passed: parsed.approved,
          detail: parsed.approved
            ? 'Review synthesis approved'
            : 'Review synthesis not approved — findings require changes',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] synthesis_approved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { guard, passed: false, detail: 'Review report has no parseable approved field' };
  }

  private async checkAcceptancePassed(
    guard: Extract<Guard, { type: 'acceptance_passed' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'acceptance_validation' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No acceptance_validation artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(artifact.content, passedGuardContentSchema);
      if (parsed) {
        return {
          guard,
          passed: parsed.passed,
          detail: parsed.passed
            ? 'Acceptance validation passed'
            : 'Acceptance validation failed — criteria not fully met',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] acceptance_passed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      guard,
      passed: false,
      detail: 'Acceptance validation artifact has no parseable passed field',
    };
  }

  private async checkTriageIndicatesPlanIssue(
    guard: Extract<Guard, { type: 'triage_indicates_plan_issue' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'remediation_plan' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No remediation_plan artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(artifact.content, triagePlanIssueGuardContentSchema);
      if (parsed) {
        return {
          guard,
          passed: parsed.planLevelIssue,
          detail: parsed.planLevelIssue
            ? 'Remediation triage indicates plan-level issue'
            : 'Remediation triage does not indicate plan-level issue',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] triage_indicates_plan_issue: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      guard,
      passed: false,
      detail: 'Remediation plan has no parseable planLevelIssue field',
    };
  }

  private async checkTriageNeedsHuman(
    guard: Extract<Guard, { type: 'triage_needs_human' }>,
  ): Promise<GuardResult> {
    const artifacts = await this.artifactStore.list({ type: 'remediation_plan' });
    if (artifacts.length === 0) {
      return { guard, passed: false, detail: 'No remediation_plan artifact found' };
    }
    const latest = artifacts[artifacts.length - 1];
    try {
      const artifact = await this.artifactStore.get(latest);
      const parsed = parseTypedArtifactContent(
        artifact.content,
        triageNeedsHumanGuardContentSchema,
      );
      if (parsed) {
        return {
          guard,
          passed: parsed.needsHuman,
          detail: parsed.needsHuman
            ? 'Remediation triage requires human input'
            : 'Remediation triage does not require human input',
        };
      }
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] triage_needs_human: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return {
      guard,
      passed: false,
      detail: 'Remediation plan has no parseable needsHuman field',
    };
  }

  private async checkContextGuard(
    guard: Extract<Guard, { type: 'previous_run_pattern' | 'known_failure_pattern' }>,
  ): Promise<GuardResult> {
    if (!this.contextStore) {
      return { guard, passed: false, detail: 'No project context store configured' };
    }
    if (guard.type === 'previous_run_pattern') {
      return evaluatePreviousRunPatternGuard(guard, this.contextStore);
    }
    return evaluateKnownFailurePatternGuard(guard, this.contextStore);
  }

  private checkConfidenceThreshold(
    guard: Extract<Guard, { type: 'confidence_threshold' }>,
  ): GuardResult {
    if (!this.lastConfidenceReport) {
      return {
        guard,
        passed: false,
        detail: 'No confidence report available',
      };
    }
    const passed = this.lastConfidenceReport.score >= guard.params.minConfidence;
    return {
      guard,
      passed,
      detail: passed
        ? `Confidence ${String(this.lastConfidenceReport.score)} >= ${String(guard.params.minConfidence)}`
        : `Confidence ${String(this.lastConfidenceReport.score)} < ${String(guard.params.minConfidence)}`,
    };
  }

  private async checkProjectContextAvailable(
    guard: Extract<Guard, { type: 'project_context_available' }>,
  ): Promise<GuardResult> {
    if (!this.contextStore) {
      return { guard, passed: false, detail: 'No project context store configured' };
    }
    const category = guard.params.category;
    if (category) {
      const doc = await this.contextStore.read(category);
      return {
        guard,
        passed: doc !== null,
        detail:
          doc !== null
            ? `Project context category "${category}" is available`
            : `Project context category "${category}" not found`,
      };
    }
    const categories = ['codebase', 'run_history', 'preferences'] as const;
    for (const cat of categories) {
      const doc = await this.contextStore.read(cat);
      if (doc) {
        return {
          guard,
          passed: true,
          detail: `Project context available (found "${cat}")`,
        };
      }
    }
    return { guard, passed: false, detail: 'No project context data found' };
  }

  private async checkSpecificationFeasible(
    guard: Extract<Guard, { type: 'specification_feasible' }>,
  ): Promise<GuardResult> {
    const artifact = await resolveCanonicalSpecification(this.artifactStore);
    if (!artifact) {
      return {
        guard,
        passed: true,
        detail:
          'No canonical_specification found — feasibility check deferred to artifact_exists guard',
      };
    }
    try {
      const parsed = parseTypedArtifactContent(artifact.content, specFeasibilityGuardContentSchema);
      if (!parsed?.feasibility) {
        return { guard, passed: true, detail: 'No feasibility field — treating as feasible' };
      }
      return {
        guard,
        passed: parsed.feasibility.feasible,
        detail: parsed.feasibility.feasible
          ? 'Specification is feasible'
          : `Specification is not feasible: ${parsed.feasibility.reason ?? ''}`,
      };
    } catch (err: unknown) {
      this.logger.debug(
        `[GuardChecker] specification_feasible: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        guard,
        passed: true,
        detail: 'Failed to parse specification — treating as feasible',
      };
    }
  }
}
