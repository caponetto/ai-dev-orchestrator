import { describe, expect, it } from 'vitest';

import {
  permissionApprovalEntrySchema,
  permissionApprovalFileSchema,
} from '../permission-approval';

const validEntry = {
  id: 'approval-001',
  action: 'file_read' as const,
  resource: '/src/index.ts',
  createdAt: '2026-01-15T10:30:00Z',
};

describe('permissionApprovalEntrySchema', () => {
  it('validates a minimal entry', () => {
    expect(permissionApprovalEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('validates with optional fields', () => {
    const data = {
      ...validEntry,
      detail: 'Read access to source file',
      createdByRole: 'implementer',
    };
    expect(permissionApprovalEntrySchema.safeParse(data).success).toBe(true);
  });

  it('validates all permission actions', () => {
    const actions = [
      'file_read',
      'file_write',
      'file_delete',
      'shell_execute',
      'network_request',
      'git_operation',
      'custom',
    ];
    for (const action of actions) {
      expect(permissionApprovalEntrySchema.safeParse({ ...validEntry, action }).success).toBe(true);
    }
  });

  it('rejects invalid action', () => {
    expect(permissionApprovalEntrySchema.safeParse({ ...validEntry, action: 'sudo' }).success).toBe(
      false,
    );
  });

  it('rejects missing id', () => {
    const { id: _, ...noId } = validEntry;
    expect(permissionApprovalEntrySchema.safeParse(noId).success).toBe(false);
  });

  it('rejects missing action', () => {
    const { action: _, ...noAction } = validEntry;
    expect(permissionApprovalEntrySchema.safeParse(noAction).success).toBe(false);
  });

  it('rejects missing resource', () => {
    const { resource: _, ...noResource } = validEntry;
    expect(permissionApprovalEntrySchema.safeParse(noResource).success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _, ...noCreatedAt } = validEntry;
    expect(permissionApprovalEntrySchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(permissionApprovalEntrySchema.safeParse({}).success).toBe(false);
  });
});

describe('permissionApprovalFileSchema', () => {
  it('validates a file with approvals', () => {
    const data = {
      version: 1,
      approvals: [validEntry],
    };
    expect(permissionApprovalFileSchema.safeParse(data).success).toBe(true);
  });

  it('validates a file with empty approvals', () => {
    const data = { version: 1, approvals: [] };
    expect(permissionApprovalFileSchema.safeParse(data).success).toBe(true);
  });

  it('validates a file with multiple approvals', () => {
    const data = {
      version: 1,
      approvals: [
        validEntry,
        {
          id: 'approval-002',
          action: 'shell_execute',
          resource: 'npm test',
          detail: 'Run tests',
          createdAt: '2026-01-15T11:00:00Z',
          createdByRole: 'planner',
        },
      ],
    };
    expect(permissionApprovalFileSchema.safeParse(data).success).toBe(true);
  });

  it('rejects wrong version number', () => {
    expect(permissionApprovalFileSchema.safeParse({ version: 2, approvals: [] }).success).toBe(
      false,
    );
  });

  it('rejects version as string', () => {
    expect(permissionApprovalFileSchema.safeParse({ version: '1', approvals: [] }).success).toBe(
      false,
    );
  });

  it('rejects missing version', () => {
    expect(permissionApprovalFileSchema.safeParse({ approvals: [] }).success).toBe(false);
  });

  it('rejects missing approvals', () => {
    expect(permissionApprovalFileSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('rejects invalid entry in approvals array', () => {
    const data = {
      version: 1,
      approvals: [{ id: 'bad', action: 'invalid_action', resource: 'r', createdAt: 'now' }],
    };
    expect(permissionApprovalFileSchema.safeParse(data).success).toBe(false);
  });
});
