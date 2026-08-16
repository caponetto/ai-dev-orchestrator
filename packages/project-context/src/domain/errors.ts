import { NonRecoverableErrorBase } from '@ai-orchestrator/ports';

export class ContextStoreInitError extends NonRecoverableErrorBase {
  readonly code = 'CONTEXT_STORE_INIT_ERROR';
}

export class ContextReadError extends NonRecoverableErrorBase {
  readonly code = 'CONTEXT_READ_ERROR';
}

export class ContextWriteError extends NonRecoverableErrorBase {
  readonly code = 'CONTEXT_WRITE_ERROR';
}
