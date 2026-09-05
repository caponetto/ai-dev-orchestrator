import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

export class WorkflowParseError extends NonRecoverableErrorBase {
  readonly code = 'WORKFLOW_PARSE_ERROR';

  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`Failed to parse workflow from "${source}": ${message}`);
  }
}

export class WorkflowValidationFailedError extends NonRecoverableErrorBase {
  readonly code = 'WORKFLOW_VALIDATION_FAILED';

  constructor(
    readonly workflowName: string,
    readonly errorCount: number,
  ) {
    super(`Workflow "${workflowName}" failed validation with ${String(errorCount)} error(s)`);
  }
}
