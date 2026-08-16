import { z } from 'zod/v4';

import { permissionApprovalEntrySchema } from '../runner/permission-approval';
import { clarificationPayloadSchema, permissionPayloadSchema } from '../runner/runner-system';

import { runSummaryViewSchema, subsystemHealthViewSchema } from './dashboard-domain';

// ---------------------------------------------------------------------------
// DashboardActionResult (mutations)
// ---------------------------------------------------------------------------

export const dashboardActionResultSchema = z
  .object({
    success: z.boolean(),
    error: z.string().optional(),
    runId: z.string().optional(),
  })
  .loose();

export type DashboardActionResult = z.infer<typeof dashboardActionResultSchema>;

// ---------------------------------------------------------------------------
// WorkflowSummary (fetchWorkflows)
// ---------------------------------------------------------------------------

export const workflowSummarySchema = z
  .object({
    name: z.string(),
    version: z.string(),
    stateCount: z.number(),
  })
  .loose();

export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

// ---------------------------------------------------------------------------
// HealthResponse (fetchHealth) — dashboard-only type
// ---------------------------------------------------------------------------

export const healthResponseSchema = z
  .object({
    status: z.string(),
    clients: z.number(),
    subsystems: z.array(subsystemHealthViewSchema).readonly(),
    timestamp: z.string(),
    uptimeMs: z.number().optional(),
    port: z.number().optional(),
    host: z.string().optional(),
    runStats: z
      .object({
        total: z.number(),
        active: z.number(),
        completed: z.number(),
        failed: z.number(),
        avgDurationMs: z.number().nullable(),
        latestRun: z.string().nullable(),
        totalInputTokens: z.number().optional(),
        totalOutputTokens: z.number().optional(),
      })
      .optional(),
  })
  .loose();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ---------------------------------------------------------------------------
// LiveRequestView (fetchLiveRequests) — dashboard-only type
// ---------------------------------------------------------------------------

export const liveRequestViewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      runId: z.string(),
      messageId: z.string(),
      kind: z.literal('permission'),
      createdAt: z.string(),
      payload: permissionPayloadSchema,
    })
    .loose(),
  z
    .object({
      runId: z.string(),
      messageId: z.string(),
      kind: z.literal('clarification'),
      createdAt: z.string(),
      payload: clarificationPayloadSchema,
    })
    .loose(),
]);

export type LiveRequestView = z.infer<typeof liveRequestViewSchema>;

// ---------------------------------------------------------------------------
// Array schemas (pre-built for consumers that don't import Zod directly)
// ---------------------------------------------------------------------------

export const runSummaryViewArraySchema = z.array(runSummaryViewSchema);
export const liveRequestViewArraySchema = z.array(liveRequestViewSchema);
export const workflowSummaryArraySchema = z.array(workflowSummarySchema);
export const permissionApprovalEntryArraySchema = z.array(permissionApprovalEntrySchema);
