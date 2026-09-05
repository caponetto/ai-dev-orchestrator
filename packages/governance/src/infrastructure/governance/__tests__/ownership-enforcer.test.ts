import type { OwnershipRegistry } from '@ai-dev-orchestrator/ports';
import type { ArtifactRef, ArtifactType } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { OwnershipEnforcer } from '../ownership-enforcer';

const makeRef = (type: string): ArtifactRef => ({
  type: type as ArtifactType,
  name: type,
  version: 1,
  checksum: 'abc123',
});

const mockRegistry: OwnershipRegistry = {
  getOwner: (type: ArtifactType) => {
    const owners: Record<string, string> = {
      implementation: 'implementer',
      plan: 'planner',
      review: 'reviewer',
    };
    return owners[type as string] ?? null;
  },
  isAuthorized: (role: string, type: ArtifactType) => {
    const ownership: Record<string, string> = {
      implementation: 'implementer',
      plan: 'planner',
      review: 'reviewer',
    };
    return ownership[type as string] === role;
  },
  getOwnedTypes: (role: string) => {
    const map: Record<string, string[]> = {
      implementer: ['implementation'],
      planner: ['plan'],
      reviewer: ['review'],
    };
    return (map[role] ?? []) as ArtifactType[];
  },
};

describe('OwnershipEnforcer', () => {
  const enforcer = new OwnershipEnforcer(mockRegistry);

  describe('checkWriteAccess()', () => {
    it('allows authorized role to write', () => {
      const result = enforcer.checkWriteAccess('implementer', makeRef('implementation'));
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('authorized');
    });

    it('denies non-authorized role write access', () => {
      const result = enforcer.checkWriteAccess('reviewer', makeRef('implementation'));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('owned by');
    });

    it('allows write when no ownership constraint exists', () => {
      const result = enforcer.checkWriteAccess('anyone', makeRef('unowned'));
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No ownership constraint');
    });
  });

  describe('checkReadAccess()', () => {
    it('allows owner implicit read', () => {
      const result = enforcer.checkReadAccess('implementer', makeRef('implementation'));
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('owns');
    });

    it('allows read when no ownership constraint', () => {
      const result = enforcer.checkReadAccess('anyone', makeRef('unowned'));
      expect(result.allowed).toBe(true);
    });

    it('grants default read access to non-owners', () => {
      const result = enforcer.checkReadAccess('security_reviewer', makeRef('implementation'));
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('granted by default');
    });
  });

  describe('validateTransitionArtifacts()', () => {
    it('validates all artifacts for production', () => {
      const result = enforcer.validateTransitionArtifacts(
        'implementer',
        [makeRef('implementation')],
        true,
      );
      expect(result.allowed).toBe(true);
    });

    it('fails when any artifact ownership check fails', () => {
      const result = enforcer.validateTransitionArtifacts(
        'reviewer',
        [makeRef('implementation'), makeRef('plan')],
        true,
      );
      expect(result.allowed).toBe(false);
    });

    it('validates all artifacts for consumption', () => {
      const result = enforcer.validateTransitionArtifacts(
        'reviewer',
        [makeRef('implementation'), makeRef('plan')],
        false,
      );
      expect(result.allowed).toBe(true);
    });

    it('passes when no artifacts provided', () => {
      const result = enforcer.validateTransitionArtifacts('anyone', [], true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('All artifact ownership checks passed');
    });
  });
});
