import { describe, expect, it } from 'vitest';

import {
  ConfigurationLoadError,
  EnvVarResolutionError,
  ConfigValidationError,
  YamlParseError,
} from '../errors';

describe('YamlParseError', () => {
  it('includes file path and line in message', () => {
    const error = new YamlParseError('/cfg/roles.yaml', 12, 5, 'unexpected key');
    expect(error.message).toBe('YAML parse error in /cfg/roles.yaml:12: unexpected key');
    expect(error.code).toBe('YAML_PARSE_ERROR');
    expect(error.filePath).toBe('/cfg/roles.yaml');
    expect(error.line).toBe(12);
    expect(error.column).toBe(5);
    expect(error.recoverable).toBe(false);
  });

  it('omits line number when undefined', () => {
    const error = new YamlParseError('/cfg/roles.yaml', undefined, undefined, 'bad');
    expect(error.message).toBe('YAML parse error in /cfg/roles.yaml: bad');
  });
});

describe('ConfigValidationError', () => {
  it('includes file path, field path, and remediation', () => {
    const error = new ConfigValidationError(
      '/cfg/providers.yaml',
      'providers.default.model',
      'must be a string',
      'Set providers.default.model to a valid model identifier.',
    );
    expect(error.message).toBe(
      'Validation error at /cfg/providers.yaml:providers.default.model: must be a string',
    );
    expect(error.code).toBe('SCHEMA_VALIDATION_ERROR');
    expect(error.filePath).toBe('/cfg/providers.yaml');
    expect(error.fieldPath).toBe('providers.default.model');
    expect(error.remediation).toBe('Set providers.default.model to a valid model identifier.');
    expect(error.recoverable).toBe(false);
  });
});

describe('EnvVarResolutionError', () => {
  it('includes variable name and location', () => {
    const error = new EnvVarResolutionError(
      'API_KEY',
      '/cfg/providers.yaml',
      'providers.openai.apiKey',
    );
    expect(error.message).toBe(
      'Environment variable API_KEY is not set (referenced at /cfg/providers.yaml:providers.openai.apiKey)',
    );
    expect(error.code).toBe('ENV_VAR_RESOLUTION_ERROR');
    expect(error.variableName).toBe('API_KEY');
    expect(error.recoverable).toBe(false);
  });
});

describe('ConfigurationLoadError', () => {
  it('includes message and validation errors', () => {
    const errors = ['field x is missing', 'field y is invalid'];
    const error = new ConfigurationLoadError('Configuration loading failed', errors);
    expect(error.message).toBe('Configuration loading failed');
    expect(error.code).toBe('CONFIGURATION_LOAD_ERROR');
    expect(error.validationErrors).toEqual(errors);
    expect(error.recoverable).toBe(false);
  });
});
