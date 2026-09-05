import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectSettingsView, MergedConfiguration } from '@ai-dev-orchestrator/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { FilesystemSettingsProvider } from '../filesystem-settings-provider';

const TEST_BUILT_IN_DEFAULTS: MergedConfiguration = {
  workflow: { name: 'dev', version: '1.0.0' },
  roles: {
    assignments: {
      planner: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      implementer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      static_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      security_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      performance_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      adversarial_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      design_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      docs_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      ux_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      requirements_analyst: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      plan_reviewer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      judge: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      verifier: { model: 'claude-opus-4-8', dispatchType: 'agent' },
      summary_writer: { model: 'claude-opus-4-8', dispatchType: 'agent' },
    },
  },
  governance: {
    iterationLimits: {
      defaults: {
        maxReviewIterations: 2,
        maxJudgeArbitrations: 1,
        maxClarificationRounds: 3,
        maxAcceptanceIterations: 3,
      },
    },
    qualityGates: {
      specificationReadiness: { minCompletenessScore: 0.8 },
      implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
    },
  },
  runtime: { logLevel: 'info' },
};

const ROLES_YAML = {
  roles: [
    {
      id: 'planner',
      name: 'Planner',
      model: 'claude-opus-4-8',
      dispatch_type: 'agent',
      runner: 'claude-code',
    },
    {
      id: 'implementer',
      name: 'Implementer',
      model: 'claude-opus-4-8',
      dispatch_type: 'agent',
      runner: 'claude-code',
    },
  ],
};

const GOVERNANCE_YAML = {
  iteration_limits: {
    max_review_iterations: 2,
    max_judge_arbitrations: 1,
    max_clarification_rounds: 3,
  },
  quality_gates: {
    specification_readiness: {
      min_completeness_score: 0.8,
    },
    implementation_review: {
      max_high_severity_findings: 0,
      max_medium_severity_findings: 3,
    },
  },
  budget: {
    max_tokens_per_run: null,
  },
};

const CONFIG_YAML = {
  log_level: 'info',
  default_workflow: 'dev',
  workflow_version: '1.0',
  global_transition_limit: 200,
};

function writeYaml(dir: string, filename: string, data: unknown): void {
  writeFileSync(join(dir, filename), stringify(data, { indent: 2 }), 'utf-8');
}

describe('FilesystemSettingsProvider', () => {
  let aiConfigDir: string;
  let provider: FilesystemSettingsProvider;

  beforeEach(() => {
    aiConfigDir = join(
      tmpdir(),
      `settings-test-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(aiConfigDir, { recursive: true });
    writeYaml(aiConfigDir, 'roles.yaml', ROLES_YAML);
    writeYaml(aiConfigDir, 'governance.yaml', GOVERNANCE_YAML);
    writeYaml(aiConfigDir, 'config.yaml', CONFIG_YAML);
    provider = new FilesystemSettingsProvider(aiConfigDir, TEST_BUILT_IN_DEFAULTS);
  });

  afterEach(() => {
    if (existsSync(aiConfigDir)) {
      rmSync(aiConfigDir, { recursive: true, force: true });
    }
  });

  describe('updateProjectSettings — role changes', () => {
    it('preserves governance structure when only model is changed', () => {
      const patch: Partial<ProjectSettingsView> = {
        roles: {
          assignments: {
            planner: { model: 'cursor-grok-4.6-medium' },
            implementer: { model: 'claude-opus-4-8' },
          },
        },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('implementation_review');
      expect(govContent).toContain('specification_readiness');
    });

    it('updates model and runner in roles.yaml', () => {
      const patch: Partial<ProjectSettingsView> = {
        roles: {
          assignments: {
            planner: { model: 'cursor-grok-4.6-medium', runner: 'cursor' },
            implementer: { model: 'claude-opus-4-8', runner: 'claude-code' },
          },
        },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const rolesContent = readFileSync(join(aiConfigDir, 'roles.yaml'), 'utf-8');
      expect(rolesContent).toContain('cursor-grok-4.6-medium');
      expect(rolesContent).toContain('cursor');
    });
  });

  describe('updateProjectSettings — governance changes', () => {
    it('preserves unmanaged quality gates when other fields change', () => {
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 5,
              maxJudgeArbitrations: 2,
              maxClarificationRounds: 4,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.9 },
            implementationReview: { maxHighSeverityFindings: 1, maxMediumSeverityFindings: 5 },
          },
        },
        runtime: { logLevel: 'info' },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('max_high_severity_findings');
      expect(govContent).toContain('max_medium_severity_findings');
    });

    it('updates iteration limits without adding a defaults wrapper', () => {
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 10,
              maxJudgeArbitrations: 3,
              maxClarificationRounds: 5,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
        },
        runtime: { logLevel: 'info' },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('max_review_iterations: 10');
      expect(govContent).not.toContain('defaults:');
    });

    it('preserves budget when governance is saved', () => {
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 2,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8, maxAmbiguities: 0 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
          budget: { maxTokensPerRun: 100_000 },
        },
        runtime: { logLevel: 'info' },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('max_tokens_per_run: 100000');
    });

    it('deep-merges individual quality gate fields without losing boolean flags', () => {
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 2,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.95 },
            implementationReview: { maxHighSeverityFindings: 1, maxMediumSeverityFindings: 5 },
          },
        },
        runtime: { logLevel: 'info' },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('min_completeness_score: 0.95');
      expect(govContent).toContain('max_high_severity_findings: 1');
    });
  });

  describe('updateProjectSettings — post-write validation', () => {
    it('rejects and rolls back a save that would corrupt the config', () => {
      // Manually corrupt the governance.yaml — missing quality_gates entirely
      const corruptedGov = {
        iteration_limits: { defaults: { max_review_iterations: 3 } },
      };
      writeYaml(aiConfigDir, 'governance.yaml', corruptedGov);

      // A new provider reading the corrupted file
      const corruptProvider = new FilesystemSettingsProvider(aiConfigDir, TEST_BUILT_IN_DEFAULTS);

      // Try to save — the validation should catch the corrupted state
      const patch: Partial<ProjectSettingsView> = {
        roles: {
          assignments: {
            planner: { model: 'cursor-grok-4.6-medium' },
            implementer: { model: 'claude-opus-4-8' },
          },
        },
      };

      const result = corruptProvider.updateProjectSettings(patch);
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rolls back YAML files when validation fails', () => {
      const badGov = { ...GOVERNANCE_YAML } as Record<string, unknown>;
      delete badGov['quality_gates'];
      writeYaml(aiConfigDir, 'governance.yaml', badGov);

      const badProvider = new FilesystemSettingsProvider(aiConfigDir, TEST_BUILT_IN_DEFAULTS);
      const patch: Partial<ProjectSettingsView> = {
        roles: {
          assignments: {
            planner: { model: 'cursor-grok-4.6-medium' },
            implementer: { model: 'claude-opus-4-8' },
          },
        },
      };

      const result = badProvider.updateProjectSettings(patch);

      expect(result.ok).toBe(false);
      expect(existsSync(join(aiConfigDir, 'governance.yaml'))).toBe(true);
    });
  });

  describe('updateProjectSettings — permission policy changes', () => {
    it('writes permission_policy to governance.yaml on save', () => {
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 2,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
          permissionPolicy: {
            defaultAction: 'deny',
            rules: [{ action: 'file_read', decision: 'grant', scope: 'src/**' }],
            roleTrust: { implementer: 'medium', planner: 'high' },
            safeCommands: ['npm test', 'npm run lint'],
          },
        },
        runtime: { logLevel: 'info' },
      };

      const result = provider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('permission_policy');
      expect(govContent).toContain('default_action: deny');
      expect(govContent).toContain('file_read');
      expect(govContent).toContain('npm test');
    });

    it('round-trips permission policy through read and write', () => {
      const policy = {
        defaultAction: 'ask_human' as const,
        rules: [{ action: 'shell_execute', decision: 'deny' as const, pattern: 'rm -rf *' }],
        roleTrust: { verifier: 'none' as const },
        safeCommands: ['git status'],
      };

      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 2,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
          permissionPolicy: policy,
        },
        runtime: { logLevel: 'info' },
      };

      provider.updateProjectSettings(patch);

      const freshProvider = new FilesystemSettingsProvider(aiConfigDir, TEST_BUILT_IN_DEFAULTS);
      const settings = freshProvider.getProjectSettings();
      expect(settings?.governance.permissionPolicy).toBeDefined();
      expect(settings?.governance.permissionPolicy?.defaultAction).toBe('ask_human');
      expect(settings?.governance.permissionPolicy?.rules).toHaveLength(1);
      expect(settings?.governance.permissionPolicy?.rules?.[0].action).toBe('shell_execute');
      expect(settings?.governance.permissionPolicy?.roleTrust?.['verifier']).toBe('none');
      expect(settings?.governance.permissionPolicy?.safeCommands).toEqual(['git status']);
    });

    it('deep-merges permission policy with existing values', () => {
      writeYaml(aiConfigDir, 'governance.yaml', {
        ...GOVERNANCE_YAML,
        permission_policy: {
          default_action: 'grant',
          safe_commands: ['echo hello'],
        },
      });

      const mergeProvider = new FilesystemSettingsProvider(aiConfigDir, TEST_BUILT_IN_DEFAULTS);
      const patch: Partial<ProjectSettingsView> = {
        governance: {
          iterationLimits: {
            defaults: {
              maxReviewIterations: 2,
              maxJudgeArbitrations: 1,
              maxClarificationRounds: 3,
            },
          },
          qualityGates: {
            specificationReadiness: { minCompletenessScore: 0.8 },
            implementationReview: { maxHighSeverityFindings: 0, maxMediumSeverityFindings: 3 },
          },
          permissionPolicy: {
            defaultAction: 'deny',
            roleTrust: { planner: 'high' },
          },
        },
        runtime: { logLevel: 'info' },
      };

      const result = mergeProvider.updateProjectSettings(patch);
      expect(result.ok).toBe(true);

      const govContent = readFileSync(join(aiConfigDir, 'governance.yaml'), 'utf-8');
      expect(govContent).toContain('default_action: deny');
      expect(govContent).toContain('planner: high');
    });
  });

  describe('getProjectSettings', () => {
    it('reads and merges YAML with defaults', () => {
      const settings = provider.getProjectSettings();
      expect(settings).not.toBeNull();
      expect(settings?.roles.assignments['planner']).toBeDefined();
      expect(settings?.roles.assignments['planner'].model).toBe('claude-opus-4-8');
      expect(settings?.governance.iterationLimits.defaults['maxReviewIterations']).toBe(2);
    });

    it('returns YAML role overrides rather than defaults', () => {
      writeYaml(aiConfigDir, 'roles.yaml', {
        roles: [{ id: 'planner', model: 'cursor-grok-4.6-medium', runner: 'cursor' }],
      });
      const settings = provider.getProjectSettings();
      expect(settings?.roles.assignments['planner'].model).toBe('cursor-grok-4.6-medium');
      expect(settings?.roles.assignments['planner'].runner).toBe('cursor');
    });

    it('returns YAML config values rather than defaults', () => {
      writeYaml(aiConfigDir, 'config.yaml', { log_level: 'debug' });
      const settings = provider.getProjectSettings();
      expect(settings?.runtime.logLevel).toBe('debug');
    });

    it('returns YAML governance overrides', () => {
      writeYaml(aiConfigDir, 'governance.yaml', {
        iteration_limits: { max_review_iterations: 7 },
        quality_gates: { specification_readiness: { min_completeness_score: 0.95 } },
      });
      const settings = provider.getProjectSettings();
      expect(settings?.governance.iterationLimits.defaults['maxReviewIterations']).toBe(7);
      expect(settings?.governance.qualityGates['specificationReadiness']).toBeDefined();
    });

    it('returns defaults when aiConfigDir does not exist', () => {
      rmSync(aiConfigDir, { recursive: true, force: true });
      const noFileProvider = new FilesystemSettingsProvider(
        join(tmpdir(), 'nonexistent-dir'),
        TEST_BUILT_IN_DEFAULTS,
      );
      const settings = noFileProvider.getProjectSettings();
      expect(settings).not.toBeNull();
      expect(settings?.runtime.logLevel).toBe('info');
    });
  });
});
