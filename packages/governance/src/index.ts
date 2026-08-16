// Domain — Governance
export { EscalationError, GovernanceError, PolicyLoadError } from './domain/governance/index';
export type { OwnershipCheckResult } from './domain/governance/index';

// Domain — Iteration Contracts
export {
  ContractNotFoundError,
  ContractStateMismatchError,
  InvalidContractError,
} from './domain/iteration-contracts/index';

// Infrastructure — Governance
export {
  DecisionRecorder,
  DefaultGovernanceEngine,
  EscalationManager,
  IterationLimiter,
  OwnershipEnforcer,
  QualityGateChecker,
} from './infrastructure/governance/index';
export type { GovernanceEngineOptions } from './infrastructure/governance/index';

// Infrastructure — Iteration Contracts
export {
  ACCEPTANCE_VALIDATION_LOOP,
  buildContracts,
  BUILT_IN_CONTRACTS,
  CLARIFICATION_LOOP,
  IMPLEMENTATION_REVIEW_LOOP,
  PLAN_REVIEW_LOOP,
  DefaultIterationContractRegistry,
} from './infrastructure/iteration-contracts/index';

// Infrastructure — Collaboration Model
export { DefaultCollaborationModel } from './infrastructure/collaboration-model/index';
