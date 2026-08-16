import { describe, expect, it } from 'vitest';

import {
  agentStreamEventTypeSchema,
  liveRequestKindSchema,
  outputFormatSchema,
  permissionActionSchema,
  permissionDecisionActionSchema,
  readinessVerdictSchema,
  roleTrustLevelSchema,
  sessionTransportSchema,
  threeTierSeveritySchema,
} from '../string-enums';

describe('threeTierSeveritySchema', () => {
  it.each(['high', 'medium', 'low'])('accepts "%s"', (val) => {
    expect(threeTierSeveritySchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid severity', () => {
    expect(threeTierSeveritySchema.safeParse('critical').success).toBe(false);
  });
});

describe('sessionTransportSchema', () => {
  it.each(['stdio', 'remote'])('accepts "%s"', (val) => {
    expect(sessionTransportSchema.safeParse(val).success).toBe(true);
  });

  it('rejects invalid transport', () => {
    expect(sessionTransportSchema.safeParse('http').success).toBe(false);
  });
});

describe('liveRequestKindSchema', () => {
  it.each(['permission', 'clarification'])('accepts "%s"', (val) => {
    expect(liveRequestKindSchema.safeParse(val).success).toBe(true);
  });
});

describe('readinessVerdictSchema', () => {
  it.each(['Ready', 'NotReady'])('accepts "%s"', (val) => {
    expect(readinessVerdictSchema.safeParse(val).success).toBe(true);
  });

  it('rejects lowercase', () => {
    expect(readinessVerdictSchema.safeParse('ready').success).toBe(false);
  });
});

describe('outputFormatSchema', () => {
  it.each(['markdown_with_frontmatter', 'yaml', 'json', 'freeform'])('accepts "%s"', (val) => {
    expect(outputFormatSchema.safeParse(val).success).toBe(true);
  });
});

describe('agentStreamEventTypeSchema', () => {
  it.each(['stdout', 'stderr', 'status', 'permission_request', 'clarification_request'])(
    'accepts "%s"',
    (val) => {
      expect(agentStreamEventTypeSchema.safeParse(val).success).toBe(true);
    },
  );
});

describe('roleTrustLevelSchema', () => {
  it.each(['high', 'medium', 'none'])('accepts "%s"', (val) => {
    expect(roleTrustLevelSchema.safeParse(val).success).toBe(true);
  });
});

describe('permissionActionSchema', () => {
  it.each([
    'file_read',
    'file_write',
    'file_delete',
    'shell_execute',
    'network_request',
    'git_operation',
    'custom',
  ])('accepts "%s"', (val) => {
    expect(permissionActionSchema.safeParse(val).success).toBe(true);
  });

  it('rejects unknown action', () => {
    expect(permissionActionSchema.safeParse('deploy').success).toBe(false);
  });
});

describe('permissionDecisionActionSchema', () => {
  it.each(['grant', 'deny', 'ask_human'])('accepts "%s"', (val) => {
    expect(permissionDecisionActionSchema.safeParse(val).success).toBe(true);
  });
});
