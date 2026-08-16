import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

export class ProfileComputationError extends NonRecoverableErrorBase {
  readonly code = 'PROFILE_COMPUTATION_ERROR';
}
