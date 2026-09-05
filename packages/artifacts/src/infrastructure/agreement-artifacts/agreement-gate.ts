import type { AgreementGate as AgreementGatePort, ArtifactStore } from '@ai-dev-orchestrator/ports';
import type {
  AgreementGateResult,
  AgreementType,
  ApprovalStatus,
  ApprovalType,
} from '@ai-dev-orchestrator/schemas';
import { z } from 'zod';

import { safeJsonParse } from '../artifact-system/content-parser';

import { DefaultAgreementValidator } from './agreement-validator';

/** Maps workflow stages to required agreement types for gating. */
const STAGE_TO_REQUIRED_AGREEMENT: Readonly<Partial<Record<string, AgreementType>>> = {
  IMPLEMENTATION: 'planning_agreement',
  VERIFICATION: 'implementation_agreement',
  WRAP_UP: 'release_agreement',
};

/** Result of stage gating check. */
interface StageGatingResult {
  readonly gated: boolean;
  readonly requiredAgreement?: AgreementType;
  readonly satisfied: boolean;
  readonly reason: string;
}

/** Default agreement gate implementation with stage gating enforcement. */
export class DefaultAgreementGate implements AgreementGatePort {
  private readonly artifactStore: ArtifactStore;
  private readonly validator = new DefaultAgreementValidator();
  private readonly agreementCache = new Map<AgreementType, AgreementGateResult>();

  constructor(artifactStore: ArtifactStore) {
    this.artifactStore = artifactStore;
  }

  /** @inheritdoc */
  register(type: AgreementType, result: AgreementGateResult): void {
    this.agreementCache.set(type, result);
  }

  /** @inheritdoc */
  check(agreementType: AgreementType, _runId: string): AgreementGateResult {
    const cached = this.agreementCache.get(agreementType);
    if (cached) {
      return cached;
    }

    return {
      exists: false,
      valid: false,
      reason: `No ${agreementType} registered yet`,
    };
  }

  /** Check if stage is gated and whether gate is satisfied. */
  checkStageGating(stageId: string): StageGatingResult {
    const requiredAgreement = STAGE_TO_REQUIRED_AGREEMENT[stageId];
    if (!requiredAgreement) {
      return { gated: false, satisfied: true, reason: 'Stage has no agreement gate' };
    }

    const gateResult = this.check(requiredAgreement, '');
    return {
      gated: true,
      requiredAgreement,
      satisfied: gateResult.exists && gateResult.valid,
      reason:
        gateResult.reason ??
        (gateResult.valid ? 'Agreement gate satisfied' : 'Agreement gate not satisfied'),
    };
  }

  /** Get required agreement type for stage. */
  getRequiredAgreement(stageId: string): AgreementType | null {
    return STAGE_TO_REQUIRED_AGREEMENT[stageId] ?? null;
  }

  /** Async version for workflow engine internal use. */
  async checkAsync(
    artifactType: AgreementType,
    agreementType: AgreementType,
  ): Promise<AgreementGateResult> {
    const latest = await this.artifactStore.getLatest(artifactType, agreementType);

    if (!latest) {
      return {
        exists: false,
        valid: false,
        reason: `No ${agreementType} artifact found`,
      };
    }

    const parseResult = safeJsonParse(latest.content, z.record(z.string(), z.unknown()));
    if (!parseResult.success) {
      return {
        exists: true,
        valid: false,
        artifactRef: latest.ref,
        reason: 'Agreement artifact content is not valid JSON',
      };
    }
    const parsedAgreement = parseResult.data;

    const agreement = {
      type: agreementType,
      runId: typeof parsedAgreement['runId'] === 'string' ? parsedAgreement['runId'] : '',
      stageId: typeof parsedAgreement['stageId'] === 'string' ? parsedAgreement['stageId'] : '',
      timestamp:
        typeof parsedAgreement['timestamp'] === 'string' ? parsedAgreement['timestamp'] : '',
      participants: (Array.isArray(parsedAgreement['participants'])
        ? parsedAgreement['participants']
        : []) as [],
      reviewedArtifacts: (Array.isArray(parsedAgreement['reviewedArtifacts'])
        ? parsedAgreement['reviewedArtifacts']
        : []) as [],
      findings: (Array.isArray(parsedAgreement['findings'])
        ? parsedAgreement['findings']
        : []) as [],
      unresolvedFindings: (Array.isArray(parsedAgreement['unresolvedFindings'])
        ? parsedAgreement['unresolvedFindings']
        : []) as [],
      approvalStatus: (parsedAgreement['approvalStatus'] ?? 'rejected') as ApprovalStatus,
      approvalType: (parsedAgreement['approvalType'] ?? 'automated') as ApprovalType,
      conditions:
        typeof parsedAgreement['conditions'] === 'string'
          ? parsedAgreement['conditions']
          : undefined,
    };

    const validation = this.validator.validate(agreement);

    return {
      exists: true,
      valid: validation.valid,
      approvalStatus: agreement.approvalStatus,
      artifactRef: latest.ref,
      reason: validation.valid ? undefined : validation.errors.join('; '),
    };
  }
}
