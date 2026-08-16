import { describe, expect, it } from 'vitest';

import { renderAgreement } from '../agreement-renderer';
import type { AgreementView } from '../shared';

describe('renderAgreement', () => {
  describe('heading — type resolution', () => {
    it('uses type when present', () => {
      const view: AgreementView = { type: 'iteration_contract' };
      const result = renderAgreement(view);
      expect(result).toContain('# Iteration Contract');
    });

    it('falls back to agreementType when type is absent', () => {
      const view: AgreementView = { agreementType: 'scope_agreement' };
      const result = renderAgreement(view);
      expect(result).toContain('# Scope Agreement');
    });

    it('prefers type over agreementType when both present', () => {
      const view: AgreementView = { type: 'iteration_contract', agreementType: 'scope_agreement' };
      const result = renderAgreement(view);
      expect(result).toContain('# Iteration Contract');
      expect(result).not.toContain('Scope Agreement');
    });

    it('defaults to "Agreement" when both are absent', () => {
      const view: AgreementView = {};
      const result = renderAgreement(view);
      expect(result).toContain('# Agreement');
    });
  });

  describe('status resolution', () => {
    it('uses status when present', () => {
      const view: AgreementView = { status: 'approved' };
      const result = renderAgreement(view);
      expect(result).toContain('**Status:** approved');
    });

    it('falls back to approvalStatus when status is absent', () => {
      const view: AgreementView = { approvalStatus: 'pending' };
      const result = renderAgreement(view);
      expect(result).toContain('**Status:** pending');
    });

    it('prefers status over approvalStatus when both present', () => {
      const view: AgreementView = { status: 'approved', approvalStatus: 'pending' };
      const result = renderAgreement(view);
      expect(result).toContain('**Status:** approved');
      expect(result).not.toContain('pending');
    });

    it('omits status section when both are absent', () => {
      const view: AgreementView = {};
      const result = renderAgreement(view);
      expect(result).not.toContain('**Status:**');
    });
  });

  describe('metadata', () => {
    it('renders metadata when id and version are present', () => {
      const view = { id: 'agr-001', version: 3 } as unknown as AgreementView;
      const result = renderAgreement(view);
      expect(result).toContain('**Id:** agr-001');
      expect(result).toContain('**Version:** 3');
    });

    it('omits metadata section when no metadata keys are present', () => {
      const view: AgreementView = { type: 'contract' };
      const result = renderAgreement(view);
      // Only heading, no metadata line
      const sections = result.split('\n\n');
      expect(sections).toHaveLength(1);
      expect(sections[0]).toBe('# Contract');
    });
  });

  describe('remaining fields', () => {
    it('renders remaining fields via renderObject', () => {
      const view = { parties: 'Alice, Bob', scope: 'Full project' } as unknown as AgreementView;
      const result = renderAgreement(view);
      expect(result).toContain('Parties');
      expect(result).toContain('Alice, Bob');
      expect(result).toContain('Scope');
      expect(result).toContain('Full project');
    });

    it('omits remaining section when no extra fields exist', () => {
      const view: AgreementView = { type: 'contract', status: 'approved' };
      const result = renderAgreement(view);
      const sections = result.split('\n\n');
      expect(sections).toHaveLength(2);
      expect(sections[0]).toBe('# Contract');
      expect(sections[1]).toBe('**Status:** approved');
    });

    it('excludes type, status, agreementType, approvalStatus, and metadata keys from remaining', () => {
      const view = {
        type: 'contract',
        agreementType: 'scope',
        status: 'approved',
        approvalStatus: 'pending',
        id: 'agr-001',
        version: 1,
        customField: 'value',
      } as unknown as AgreementView;
      const result = renderAgreement(view);
      // customField should appear
      expect(result).toContain('Custom Field');
      expect(result).toContain('value');
    });
  });

  describe('full integration', () => {
    it('renders a complete agreement with all fields', () => {
      const view = {
        type: 'iteration_contract',
        status: 'approved',
        id: 'agr-042',
        version: 2,
        parties: 'Team Alpha',
        deliverables: 'Feature X',
      } as unknown as AgreementView;
      const result = renderAgreement(view);
      expect(result).toContain('# Iteration Contract');
      expect(result).toContain('**Id:** agr-042');
      expect(result).toContain('**Version:** 2');
      expect(result).toContain('**Status:** approved');
      expect(result).toContain('Parties');
      expect(result).toContain('Team Alpha');
      expect(result).toContain('Deliverables');
      expect(result).toContain('Feature X');
    });

    it('renders minimal agreement with empty view', () => {
      const view: AgreementView = {};
      const result = renderAgreement(view);
      expect(result).toBe('# Agreement');
    });

    it('sections are separated by double newlines', () => {
      const view = {
        type: 'contract',
        status: 'active',
        id: 'x',
        extra: 'data',
      } as unknown as AgreementView;
      const result = renderAgreement(view);
      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });
  });
});
