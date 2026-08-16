import { z } from 'zod/v4';

import {
  ACTION_TYPES,
  GUARD_TYPES,
  STATE_TYPES,
  TRANSITION_TRIGGERS,
  type Action,
  type Guard,
} from './workflow-engine';

/**
 * Loose Zod schema for camelCase workflow definition files (JSON/YAML after
 * key normalization). Stricter domain shape is {@link workflowDefinitionSchema}.
 */
const workflowFileGuardSchema = z
  .object({
    type: z.enum(GUARD_TYPES),
    params: z.record(z.string(), z.unknown()).catch({}),
  })
  .transform((v) => v as unknown as Guard);

const workflowFileActionSchema = z
  .object({
    type: z.enum(ACTION_TYPES),
    params: z.record(z.string(), z.unknown()).catch({}),
  })
  .transform((v) => v as unknown as Action);

const workflowFileTransitionSchema = z.object({
  target: z.string(),
  trigger: z.enum(TRANSITION_TRIGGERS),
  guards: z.array(workflowFileGuardSchema).optional().default([]),
  governanceRequired: z.boolean().optional().default(false),
  priority: z.number().optional().default(0),
});

const workflowFileStateSchema = z.object({
  type: z.enum(STATE_TYPES),
  label: z.string().optional(),
  description: z.string().catch(''),
  entryActions: z.array(workflowFileActionSchema).optional(),
  exitActions: z.array(workflowFileActionSchema).optional(),
  transitions: z.array(workflowFileTransitionSchema).optional().default([]),
});

export const workflowSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  initialState: z.string().min(1),
  terminalStates: z.array(z.string()).min(1),
  states: z.record(z.string(), workflowFileStateSchema),
});

export type WorkflowFile = z.infer<typeof workflowSchema>;
