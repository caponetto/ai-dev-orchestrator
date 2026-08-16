import { z } from 'zod/v4';

import { permissionActionSchema } from '../shared/string-enums';

export const permissionApprovalEntrySchema = z.object({
  id: z.string(),
  action: permissionActionSchema,
  resource: z.string(),
  detail: z.string().optional(),
  createdAt: z.string(),
  createdByRole: z.string().optional(),
});
export type PermissionApprovalEntry = z.infer<typeof permissionApprovalEntrySchema>;

export const permissionApprovalFileSchema = z.object({
  version: z.literal(1),
  approvals: z.array(permissionApprovalEntrySchema).readonly(),
});
export type PermissionApprovalFile = z.infer<typeof permissionApprovalFileSchema>;
