import { OrchestratorError } from '@ai-orchestrator/ports';
import { describe, expect, it } from 'vitest';

import { EventBusError, SubscriberError } from '../errors';

describe('Event System Errors', () => {
  it('EventBusError has correct code and is recoverable', () => {
    const error = new EventBusError('bus failure');
    expect(error.code).toBe('EVENT_BUS_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.message).toBe('bus failure');
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('SubscriberError includes subscriber name and cause', () => {
    const cause = new Error('handler threw');
    const error = new SubscriberError('journal-writer', cause);
    expect(error.code).toBe('SUBSCRIBER_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.subscriberName).toBe('journal-writer');
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('journal-writer');
    expect(error.message).toContain('handler threw');
  });

  it('all errors have correct name from constructor', () => {
    expect(new EventBusError('x').name).toBe('EventBusError');
    expect(new SubscriberError('x', new Error('y')).name).toBe('SubscriberError');
  });
});
