import { NonRecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Thrown when a YAML configuration file cannot be parsed. */
export class YamlParseError extends NonRecoverableErrorBase {
  readonly code = 'YAML_PARSE_ERROR';

  constructor(
    readonly filePath: string,
    readonly line: number | undefined,
    readonly column: number | undefined,
    message: string,
  ) {
    super(
      `YAML parse error in ${filePath}${line !== undefined ? `:${String(line)}` : ''}: ${message}`,
    );
  }
}

/** Thrown when configuration validation against the schema fails. */
export class ConfigValidationError extends NonRecoverableErrorBase {
  readonly code = 'SCHEMA_VALIDATION_ERROR';

  constructor(
    readonly filePath: string,
    readonly fieldPath: string,
    message: string,
    readonly remediation: string,
  ) {
    super(`Validation error at ${filePath}:${fieldPath}: ${message}`);
  }
}

/** Thrown when an environment variable reference cannot be resolved. */
export class EnvVarResolutionError extends NonRecoverableErrorBase {
  readonly code = 'ENV_VAR_RESOLUTION_ERROR';

  constructor(
    readonly variableName: string,
    readonly filePath: string,
    readonly fieldPath: string,
  ) {
    super(
      `Environment variable ${variableName} is not set (referenced at ${filePath}:${fieldPath})`,
    );
  }
}

/** Thrown when the overall configuration load fails. */
export class ConfigurationLoadError extends NonRecoverableErrorBase {
  readonly code = 'CONFIGURATION_LOAD_ERROR';

  constructor(
    message: string,
    readonly validationErrors: readonly string[],
  ) {
    super(message);
  }
}
