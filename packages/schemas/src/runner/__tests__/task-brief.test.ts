import { describe, expect, it } from 'vitest';

import { taskBriefSchema } from '../task-brief';

describe('taskBriefSchema', () => {
  it('accepts a valid task brief', () => {
    const result = taskBriefSchema.safeParse({
      what: 'Implement the login endpoint',
      why: 'Users need to authenticate to access protected resources',
      successCriteria: [
        { id: 'sc-1', description: 'Returns 200 with valid credentials', verifiable: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a task brief with optional how', () => {
    const result = taskBriefSchema.safeParse({
      what: 'Implement the login endpoint',
      why: 'Users need to authenticate',
      how: 'Use bcrypt for password hashing',
      successCriteria: [
        { id: 'sc-1', description: 'Returns 200 with valid credentials', verifiable: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when what is missing', () => {
    const result = taskBriefSchema.safeParse({
      why: 'Users need to authenticate',
      successCriteria: [{ id: 'sc-1', description: 'Returns 200', verifiable: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when successCriteria is empty', () => {
    const result = taskBriefSchema.safeParse({
      what: 'Implement login',
      why: 'Auth needed',
      successCriteria: [],
    });
    expect(result.success).toBe(false);
  });
});
