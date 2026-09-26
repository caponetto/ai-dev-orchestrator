import { describe, expect, it } from 'vitest';

import { isTransientCliError } from '../transient-cli-error';

describe('isTransientCliError', () => {
  it.each([
    'Unexpected server error',
    'HTTP 503 Service Unavailable',
    '529 overloaded_error',
    'rate_limit_error',
    'Connection reset by peer',
  ])('recognizes a transient service failure: %s', (message) => {
    expect(isTransientCliError(message)).toBe(true);
  });

  it.each(['Permission denied', 'Invalid API key', 'Model not found'])(
    'keeps permanent failures nonrecoverable: %s',
    (message) => {
      expect(isTransientCliError(message)).toBe(false);
    },
  );
});
