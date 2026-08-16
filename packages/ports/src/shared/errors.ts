export abstract class OrchestratorError extends Error {
  abstract readonly code: string;
  abstract readonly recoverable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export abstract class RecoverableErrorBase extends OrchestratorError {
  readonly recoverable: boolean = true;
}

export abstract class NonRecoverableErrorBase extends OrchestratorError {
  readonly recoverable = false;
}
