import { RecoverableErrorBase } from '@ai-dev-orchestrator/ports';

/** Error publishing or dispatching an event. */
export class EventBusError extends RecoverableErrorBase {
  readonly code = 'EVENT_BUS_ERROR';
}

/** A subscriber threw an error during event handling. */
export class SubscriberError extends RecoverableErrorBase {
  readonly code = 'SUBSCRIBER_ERROR';
  readonly subscriberName: string;
  override readonly cause: Error;

  constructor(subscriberName: string, cause: Error) {
    super(`Subscriber "${subscriberName}" threw: ${cause.message}`);
    this.subscriberName = subscriberName;
    this.cause = cause;
  }
}
