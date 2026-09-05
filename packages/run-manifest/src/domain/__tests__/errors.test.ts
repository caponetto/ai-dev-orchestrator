import { OrchestratorError } from '@ai-dev-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { ManifestProductionError } from '../errors';

describe('run manifest errors', () => {
  it('ManifestProductionError includes cause', () => {
    const error = new ManifestProductionError('missing journal');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error.code).toBe('MANIFEST_PRODUCTION_ERROR');
    expect(error.recoverable).toBe(false);
    expect(error.cause).toBe('missing journal');
    expect(error.message).toContain('missing journal');
  });

  it('has correct name from constructor', () => {
    expect(new ManifestProductionError('x').name).toBe('ManifestProductionError');
  });
});
