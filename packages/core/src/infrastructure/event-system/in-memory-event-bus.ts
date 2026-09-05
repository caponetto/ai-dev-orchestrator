import type { EventBus, EventJournal } from '@ai-dev-orchestrator/ports';
import type {
  Event,
  EventBusConfig,
  EventFilter,
  EventHandler,
  EventInput,
  Subscription,
  SubscriptionOptions,
} from '@ai-dev-orchestrator/schemas';

import { SubscriberError } from '../../domain/event-system/errors';

import { SequenceGenerator } from './sequence-generator';
import { UlidIdGenerator } from './ulid-id-generator';
import type { RandomSource } from './ulid-id-generator';

const DEFAULT_SYNC_TIMEOUT = 5000;
const DEFAULT_ASYNC_TIMEOUT = 10000;
const DEFAULT_MAX_ASYNC_QUEUE_SIZE = 10000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

interface InternalSubscription {
  readonly subscription: Subscription;
  readonly handler: EventHandler;
}

interface AsyncQueueEntry {
  readonly event: Event;
  readonly subscriptions: readonly InternalSubscription[];
}

/**
 * In-memory EventBus implementation.
 *
 * @remarks
 * Enriches EventInput with id, runId, sequence, and timestamp.
 * Dispatches sync subscribers in priority order (blocking).
 * Queues async subscribers for non-blocking delivery with back-pressure.
 * Isolates errors: a throwing subscriber does not prevent subsequent delivery.
 * Tracks consecutive async failures per subscription, auto-unsubscribing after threshold.
 */
export class InMemoryEventBus implements EventBus {
  private readonly subscriptions: InternalSubscription[] = [];
  private readonly idGenerator: UlidIdGenerator;
  private readonly sequenceGenerator: SequenceGenerator;
  private readonly runId: string;
  private readonly clock: () => number;
  private subIdCounter = 0;
  private readonly errorHandler: (error: SubscriberError) => void;
  private readonly config: Required<EventBusConfig>;
  private readonly journal: EventJournal | null;
  private readonly asyncQueue: AsyncQueueEntry[] = [];
  private draining = false;
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(options: {
    runId: string;
    random?: RandomSource;
    clock?: () => number;
    onSubscriberError?: (error: SubscriberError) => void;
    config?: EventBusConfig;
    journal?: EventJournal;
  }) {
    this.runId = options.runId;
    this.idGenerator = new UlidIdGenerator(options.random);
    this.sequenceGenerator = new SequenceGenerator();
    this.clock = options.clock ?? (() => Date.now());
    this.errorHandler = options.onSubscriberError ?? (() => {});
    this.config = {
      syncTimeout: options.config?.syncTimeout ?? DEFAULT_SYNC_TIMEOUT,
      asyncTimeout: options.config?.asyncTimeout ?? DEFAULT_ASYNC_TIMEOUT,
      maxAsyncQueueSize: options.config?.maxAsyncQueueSize ?? DEFAULT_MAX_ASYNC_QUEUE_SIZE,
      overflowStrategy: options.config?.overflowStrategy ?? 'drop-oldest',
      maxConsecutiveFailures:
        options.config?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
    };
    this.journal = options.journal ?? null;
  }

  publish(input: EventInput): Event {
    const now = this.clock();
    const event: Event = {
      ...input,
      id: this.idGenerator.generate(now),
      runId: this.runId,
      sequence: this.sequenceGenerator.next(),
      timestamp: new Date(now).toISOString(),
    };

    if (this.journal) {
      this.journal.append(event);
    }

    const matching = this.getMatchingSubscriptions(event);

    const sync = matching
      .filter((s) => s.subscription.options.mode === 'sync')
      .sort(
        (a, b) =>
          (a.subscription.options.priority ?? 100) - (b.subscription.options.priority ?? 100),
      );

    const asyncSubs = matching.filter((s) => s.subscription.options.mode === 'async');

    for (const sub of sync) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          void this.raceSyncTimeout(result, sub);
        }
      } catch (error: unknown) {
        this.reportError(sub, error);
      }
    }

    if (asyncSubs.length > 0) {
      this.enqueueAsync(event, asyncSubs);
    }

    return event;
  }

  subscribe(
    filter: EventFilter,
    handler: EventHandler,
    options?: SubscriptionOptions,
  ): Subscription {
    const resolvedOptions: SubscriptionOptions = {
      mode: options?.mode ?? 'async',
      priority: options?.priority ?? 100,
      name: options?.name,
    };

    const subscription: Subscription = {
      id: `sub-${String(++this.subIdCounter)}`,
      filter,
      options: resolvedOptions,
    };

    this.subscriptions.push({ subscription, handler });
    return subscription;
  }

  unsubscribe(subscription: Subscription): void {
    const index = this.subscriptions.findIndex((s) => s.subscription.id === subscription.id);
    if (index !== -1) {
      this.subscriptions.splice(index, 1);
    }
    this.consecutiveFailures.delete(subscription.id);
  }

  replay(events: readonly Event[], filter: EventFilter, handler: EventHandler): void;
  replay(filter: EventFilter, handler: EventHandler): void;
  replay(
    eventsOrFilter: readonly Event[] | EventFilter,
    filterOrHandler: EventFilter | EventHandler,
    maybeHandler?: EventHandler,
  ): void {
    if (Array.isArray(eventsOrFilter)) {
      const events = eventsOrFilter as readonly Event[];
      const filter = filterOrHandler as EventFilter;
      if (!maybeHandler) {
        return;
      }
      const handler = maybeHandler;
      for (const event of events) {
        if (this.matchesFilter(event, filter)) {
          void handler(event);
        }
      }
    } else {
      if (!this.journal) {
        return;
      }
      const filter = eventsOrFilter as EventFilter;
      const handler = filterOrHandler as EventHandler;
      const events = this.journal.readAll();
      for (const event of events) {
        if (this.matchesFilter(event, filter)) {
          void handler(event);
        }
      }
    }
  }

  private enqueueAsync(event: Event, subscriptions: readonly InternalSubscription[]): void {
    if (this.asyncQueue.length >= this.config.maxAsyncQueueSize) {
      this.asyncQueue.shift();
      this.publishWarning(
        `Async event queue overflow (max ${String(this.config.maxAsyncQueueSize)}), dropped oldest entry`,
      );
    }

    this.asyncQueue.push({ event, subscriptions });

    if (!this.draining) {
      this.draining = true;
      void Promise.resolve().then(() => this.drainQueue());
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.asyncQueue.length > 0) {
      const entry = this.asyncQueue.shift();
      if (!entry) {
        break;
      }
      for (const sub of entry.subscriptions) {
        if (!this.subscriptions.some((s) => s.subscription.id === sub.subscription.id)) {
          continue;
        }
        await this.executeAsyncHandler(sub, entry.event);
      }
    }
    this.draining = false;
  }

  private async executeAsyncHandler(sub: InternalSubscription, event: Event): Promise<void> {
    try {
      const result = sub.handler(event);
      if (result instanceof Promise) {
        await this.raceWithTimeout(result, this.config.asyncTimeout);
      }
      this.consecutiveFailures.set(sub.subscription.id, 0);
    } catch (error: unknown) {
      this.reportError(sub, error);
      this.trackFailure(sub);
    }
  }

  private async raceSyncTimeout(promise: Promise<void>, sub: InternalSubscription): Promise<void> {
    try {
      await this.raceWithTimeout(promise, this.config.syncTimeout);
    } catch (error: unknown) {
      this.reportError(sub, error);
    }
  }

  private trackFailure(sub: InternalSubscription): void {
    const subId = sub.subscription.id;
    const count = (this.consecutiveFailures.get(subId) ?? 0) + 1;
    this.consecutiveFailures.set(subId, count);

    if (count >= this.config.maxConsecutiveFailures) {
      this.unsubscribe(sub.subscription);
      this.publishWarning(
        `Auto-unsubscribed "${sub.subscription.options.name ?? subId}" after ${String(count)} consecutive failures`,
      );
    }
  }

  private publishWarning(message: string): void {
    const now = this.clock();
    const warningEvent: Event = {
      type: 'system.warning',
      source: 'system',
      data: { component: 'event-bus', message },
      id: this.idGenerator.generate(now),
      runId: this.runId,
      sequence: this.sequenceGenerator.next(),
      timestamp: new Date(now).toISOString(),
    };

    const sync = this.getMatchingSubscriptions(warningEvent)
      .filter((s) => s.subscription.options.mode === 'sync')
      .sort(
        (a, b) =>
          (a.subscription.options.priority ?? 100) - (b.subscription.options.priority ?? 100),
      );

    for (const s of sync) {
      try {
        void s.handler(warningEvent);
      } catch {
        // best-effort warning delivery
      }
    }
  }

  private reportError(sub: InternalSubscription, error: unknown): void {
    const subscriberError = new SubscriberError(
      sub.subscription.options.name ?? sub.subscription.id,
      error instanceof Error ? error : new Error(String(error)),
    );
    this.errorHandler(subscriberError);
  }

  private raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Timeout after ${String(ms)}ms`));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    });
  }

  private getMatchingSubscriptions(event: Event): readonly InternalSubscription[] {
    return this.subscriptions.filter((s) => this.matchesFilter(event, s.subscription.filter));
  }

  private matchesFilter(event: Event, filter: EventFilter): boolean {
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(event.type)) {
        return false;
      }
    }

    if (filter.source && filter.source !== event.source) {
      return false;
    }

    if (filter.correlationId && filter.correlationId !== event.correlationId) {
      return false;
    }

    return true;
  }
}
