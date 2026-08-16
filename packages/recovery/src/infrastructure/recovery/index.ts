export { ArtifactConsistencyChecker } from './artifact-consistency-checker';
export type { ConsistencyReport, RepairResult } from './artifact-consistency-checker';
export { RecoveryManager } from './recovery-manager';
export {
  lockFileContentSchema,
  recoveryResultSchema,
  recoveryScenarioSchema,
  shutdownStateSchema,
} from './recovery-schemas';
export type {
  LockFileContent,
  RecoveryResult,
  RecoveryScenario,
  ShutdownState,
} from './recovery-schemas';
export { ShutdownCoordinator } from './shutdown-coordinator';
export { StateReconstructor } from './state-reconstructor';
export type { StateRebuilder } from './state-reconstructor';
