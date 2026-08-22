// Domain — Runner System
export {
  AllRetriesExhaustedError,
  ContextAssemblyError,
  InvalidOutputError,
  OutputOwnershipError,
  WorkerDispatchError,
  WorkerTimeoutError,
} from './domain/runner-system/index';

export type { AgentSessionDescriptor, SessionParseResult } from './domain/runner-system/index';

export {
  parseSubmitResponse,
  shouldUseProtocolMode,
  isResumableSession,
} from './domain/runner-system/index';

// Infrastructure — Runner System
export {
  AgentTaskAssembler,
  CliAgentRunner,
  DefaultRunnerSystem,
  HttpAgentRunner,
  agentStreamEventSchema,
  FileBackedAgentStreamBus,
  InMemoryAgentStreamBus,
  MetricsRecorder,
  OutputProcessor,
  ParallelManager,
  RunnerContextAssembler,
  generateWorkerId,
  resetWorkerCounter,
  setWorkerCounter,
} from './infrastructure/runner-system/index';
export { isRetryableWorkerError } from './infrastructure/runner-system/index';
export {
  DefaultPermissionPolicy,
  FileBackedPermissionApprovalStore,
  serializeMessage,
  deserializeMessage,
  FileBackedLiveRequestStore,
  DefaultAgentSessionStore,
  AgentSessionReaper,
  AgentSessionRegistry,
  AgentSessionRequestRouter,
  LocalAgentSessionHost,
  CompositeAgentSessionSupervisor,
  LocalAgentSessionSupervisor,
  RemoteAgentSessionSupervisor,
  WebSocketProtocolTransport,
} from './infrastructure/runner-system/index';
export type {
  MetricsInput,
  DispatchFn,
  ParseSuccess,
  ParseFailure,
  LiveRequestStore,
  LiveRequest,
  LiveResponse,
  PermissionApprovalStore,
  ReaperPolicy,
} from './infrastructure/runner-system/index';

export { StdioProtocolTransport } from './infrastructure/runner-system/index';
export type { WebSocketLike } from './infrastructure/runner-system/index';
