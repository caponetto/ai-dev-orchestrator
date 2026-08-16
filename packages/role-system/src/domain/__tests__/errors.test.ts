import { describe, expect, it } from 'vitest';

import {
  CircularReviewError,
  ModelAssignmentError,
  OwnershipConflictError,
  PermissionDeniedError,
  RoleNotFoundError,
  RoleRegistrationError,
  VisibilityViolationError,
} from '../errors';

describe('Role System Errors', () => {
  it('RoleNotFoundError', () => {
    const err = new RoleNotFoundError('unknown_role');
    expect(err.code).toBe('ROLE_NOT_FOUND');
    expect(err.roleId).toBe('unknown_role');
    expect(err.message).toContain('unknown_role');
    expect(err.recoverable).toBe(false);
  });

  it('OwnershipConflictError', () => {
    const err = new OwnershipConflictError('plan', 'planner', 'judge');
    expect(err.code).toBe('OWNERSHIP_CONFLICT');
    expect(err.artifactType).toBe('plan');
    expect(err.roleA).toBe('planner');
    expect(err.roleB).toBe('judge');
    expect(err.message).toContain('plan');
  });

  it('PermissionDeniedError', () => {
    const err = new PermissionDeniedError('reviewer', 'produce', 'not authorized');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.roleId).toBe('reviewer');
    expect(err.operation).toBe('produce');
  });

  it('VisibilityViolationError', () => {
    const err = new VisibilityViolationError('planner', 'implementation');
    expect(err.code).toBe('VISIBILITY_VIOLATION');
    expect(err.roleId).toBe('planner');
    expect(err.artifactType).toBe('implementation');
  });

  it('CircularReviewError', () => {
    const err = new CircularReviewError(['role_a', 'role_b', 'role_a']);
    expect(err.code).toBe('CIRCULAR_REVIEW');
    expect(err.chain).toEqual(['role_a', 'role_b', 'role_a']);
    expect(err.message).toContain('role_a → role_b → role_a');
  });

  it('ModelAssignmentError', () => {
    const err = new ModelAssignmentError('test_role');
    expect(err.code).toBe('MODEL_ASSIGNMENT_ERROR');
    expect(err.roleId).toBe('test_role');
  });

  it('RoleRegistrationError', () => {
    const err = new RoleRegistrationError('custom_role', 'duplicate ID');
    expect(err.code).toBe('ROLE_REGISTRATION_FAILED');
    expect(err.roleId).toBe('custom_role');
    expect(err.reason).toBe('duplicate ID');
    expect(err.message).toContain('custom_role');
    expect(err.message).toContain('duplicate ID');
    expect(err.recoverable).toBe(false);
  });
});
