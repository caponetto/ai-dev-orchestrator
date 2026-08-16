import { describe, expect, it } from 'vitest';

import { noopLogger } from '../noop-logger';

describe('noopLogger', () => {
  it('silently discards all messages without throwing', () => {
    expect(() => {
      noopLogger.debug('test');
    }).not.toThrow();
    expect(() => {
      noopLogger.info('test');
    }).not.toThrow();
    expect(() => {
      noopLogger.warn('test');
    }).not.toThrow();
    expect(() => {
      noopLogger.error('test');
    }).not.toThrow();
  });
});
