import { z } from 'zod/v4';

import { eventSourceSchema, eventTypeSchema } from './event-types';

// ---------------------------------------------------------------------------
// Event filter / subscription / config types
// ---------------------------------------------------------------------------

export const eventFilterSchema = z.object({
  types: z.array(eventTypeSchema).readonly().optional(),
  source: eventSourceSchema.optional(),
  correlationId: z.string().optional(),
});
export type EventFilter = z.infer<typeof eventFilterSchema>;

export const subscriptionOptionsSchema = z.object({
  mode: z.enum(['sync', 'async']),
  priority: z.number().optional(),
  name: z.string().optional(),
});
export type SubscriptionOptions = z.infer<typeof subscriptionOptionsSchema>;

export const subscriptionSchema = z.object({
  id: z.string(),
  filter: eventFilterSchema,
  options: subscriptionOptionsSchema,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const eventBusConfigSchema = z.object({
  syncTimeout: z.number().optional(),
  asyncTimeout: z.number().optional(),
  maxAsyncQueueSize: z.number().optional(),
  overflowStrategy: z.enum(['drop-oldest']).optional(),
  maxConsecutiveFailures: z.number().optional(),
});
export type EventBusConfig = z.infer<typeof eventBusConfigSchema>;
