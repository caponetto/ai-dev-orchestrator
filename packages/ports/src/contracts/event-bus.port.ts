import type {
  Event,
  EventFilter,
  EventHandler,
  EventInput,
  Subscription,
  SubscriptionOptions,
} from '@ai-dev-orchestrator/schemas';

/**
 * In-process event bus for typed, ordered event distribution.
 *
 * @remarks
 * Synchronous subscribers execute in priority order and block the publisher.
 * Asynchronous subscribers are dispatched after all sync subscribers complete
 * and do not block the publisher.
 */
export interface EventBus {
  /**
   * Publish an event to all matching subscribers.
   *
   * @param event - The event input to publish
   * @returns The enriched event with id, sequence, and timestamp
   */
  publish(event: EventInput): Event;

  /**
   * Subscribe to events matching a filter.
   *
   * @param filter - Criteria to match events
   * @param handler - Function to invoke on matching events
   * @param options - Subscription configuration (mode, priority, name)
   * @returns A subscription handle for unsubscription
   */
  subscribe(
    filter: EventFilter,
    handler: EventHandler,
    options?: SubscriptionOptions,
  ): Subscription;

  /**
   * Remove a subscription.
   *
   * @param subscription - The subscription to remove
   */
  unsubscribe(subscription: Subscription): void;

  /**
   * Replay events through the bus for late-joining subscribers.
   *
   * @param events - Array of events to replay
   * @param filter - Filter to apply during replay
   * @param handler - Handler to receive replayed events
   */
  replay(events: readonly Event[], filter: EventFilter, handler: EventHandler): void;
}
