import { describe, expect, it } from 'vitest';

import {
  StaticFileValidationError,
  configSchema,
  governanceSchema,
  roleSchema,
  runnersSchema,
  validateStatic,
  workflowYamlSchema,
} from '../static-schemas';

describe('static-schemas (dedicated)', () => {
  describe('StaticFileValidationError', () => {
    it('is an instance of Error', () => {
      const err = new StaticFileValidationError('test.yaml', ['issue 1']);
      expect(err).toBeInstanceOf(Error);
    });

    it('has name set to StaticFileValidationError', () => {
      const err = new StaticFileValidationError('test.yaml', ['issue 1']);
      expect(err.name).toBe('StaticFileValidationError');
    });

    it('stores file and issues properties', () => {
      const err = new StaticFileValidationError('config.yaml', ['bad field', 'missing key']);
      expect(err.file).toBe('config.yaml');
      expect(err.issues).toEqual(['bad field', 'missing key']);
    });

    it('formats message with file name and issues', () => {
      const err = new StaticFileValidationError('config.yaml', ['issue A', 'issue B']);
      expect(err.message).toContain('config.yaml');
      expect(err.message).toContain('issue A');
      expect(err.message).toContain('issue B');
    });

    it('handles single issue', () => {
      const err = new StaticFileValidationError('roles/test.yaml', ['only issue']);
      expect(err.issues).toHaveLength(1);
      expect(err.message).toContain('only issue');
    });
  });

  describe('validateStatic', () => {
    it('returns data when schema matches', () => {
      const schema = configSchema.pick({ log_level: true });
      const validData = { log_level: 'info' };
      expect(validateStatic(schema, validData, 'test.yaml')).toEqual(validData);
    });

    it('throws StaticFileValidationError with path info on nested errors', () => {
      const data = {
        log_level: 'info',
        default_workflow: 'dev',
        workflow_version: '1.0',
        global_transition_limit: -5,
      };
      try {
        validateStatic(configSchema, data, 'config.yaml');
        expect.unreachable('should have thrown');
      } catch (e) {
        const err = e as StaticFileValidationError;
        expect(err.file).toBe('config.yaml');
        expect(err.issues.some((i) => i.includes('global_transition_limit'))).toBe(true);
      }
    });

    it('reports <root> for top-level type mismatches', () => {
      try {
        validateStatic(configSchema, 'not an object', 'config.yaml');
        expect.unreachable('should have thrown');
      } catch (e) {
        const err = e as StaticFileValidationError;
        expect(err.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('configSchema edge cases', () => {
    const validConfig = {
      log_level: 'debug',
      default_workflow: 'dev',
      workflow_version: '2.0',
      global_transition_limit: 1,
    };

    it('accepts all valid log_level values', () => {
      for (const level of ['debug', 'info', 'warn', 'error']) {
        const data = { ...validConfig, log_level: level };
        expect(validateStatic(configSchema, data, 'c.yaml')).toEqual(data);
      }
    });

    it('accepts optional report_output_path', () => {
      const data = { ...validConfig, report_output_path: './report.md' };
      expect(validateStatic(configSchema, data, 'c.yaml')).toEqual(data);
    });

    it('accepts config without report_output_path', () => {
      expect(validateStatic(configSchema, validConfig, 'c.yaml')).toEqual(validConfig);
    });

    it('rejects empty default_workflow', () => {
      const data = { ...validConfig, default_workflow: '' };
      expect(() => validateStatic(configSchema, data, 'c.yaml')).toThrow(StaticFileValidationError);
    });

    it('rejects negative global_transition_limit', () => {
      const data = { ...validConfig, global_transition_limit: -1 };
      expect(() => validateStatic(configSchema, data, 'c.yaml')).toThrow(StaticFileValidationError);
    });

    it('rejects fractional global_transition_limit', () => {
      const data = { ...validConfig, global_transition_limit: 1.5 };
      expect(() => validateStatic(configSchema, data, 'c.yaml')).toThrow(StaticFileValidationError);
    });
  });

  describe('runnersSchema edge cases', () => {
    it('accepts multiple runners', () => {
      const data = {
        runners: [
          { id: 'r1', name: 'Runner 1', models: ['model-a'] },
          { id: 'r2', name: 'Runner 2', models: ['model-b', 'model-c'] },
        ],
      };
      expect(validateStatic(runnersSchema, data, 'r.yaml')).toEqual(data);
    });

    it('rejects runner with empty id', () => {
      const data = { runners: [{ id: '', name: 'Test', models: ['m'] }] };
      expect(() => validateStatic(runnersSchema, data, 'r.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects runner with empty name', () => {
      const data = { runners: [{ id: 'test', name: '', models: ['m'] }] };
      expect(() => validateStatic(runnersSchema, data, 'r.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects runner with empty model string', () => {
      const data = { runners: [{ id: 'test', name: 'Test', models: [''] }] };
      expect(() => validateStatic(runnersSchema, data, 'r.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects missing runners key', () => {
      expect(() => validateStatic(runnersSchema, {}, 'r.yaml')).toThrow(StaticFileValidationError);
    });
  });

  describe('roleSchema edge cases', () => {
    const validRole = {
      id: 'test_role',
      name: 'Test Role',
      description: 'A test role for validation',
      owned_artifacts: ['artifact_a'],
      readable_artifacts: ['artifact_b'],
      forbidden_artifacts: [],
      reviewed_by: [],
      reviews: [],
      agreement_participation: [],
      required_capabilities: ['reasoning'],
      model: 'test-model',
      max_tokens: null,
      dispatch_type: 'agent',
      runner: 'cursor',
    };

    it('accepts role with agent_config', () => {
      const data = {
        ...validRole,
        agent_config: { model: 'custom-model', timeoutMs: 30000 },
      };
      expect(validateStatic(roleSchema, data, 'r.yaml').agent_config).toEqual({
        model: 'custom-model',
        timeoutMs: 30000,
      });
    });

    it('accepts role without agent_config', () => {
      expect(validateStatic(roleSchema, validRole, 'r.yaml')).toEqual(validRole);
    });

    it('rejects role with empty id', () => {
      const data = { ...validRole, id: '' };
      expect(() => validateStatic(roleSchema, data, 'r.yaml')).toThrow(StaticFileValidationError);
    });

    it('accepts role with positive max_tokens', () => {
      const data = { ...validRole, max_tokens: 4096 };
      expect(validateStatic(roleSchema, data, 'r.yaml').max_tokens).toBe(4096);
    });

    it('rejects role with zero max_tokens', () => {
      const data = { ...validRole, max_tokens: 0 };
      expect(() => validateStatic(roleSchema, data, 'r.yaml')).toThrow(StaticFileValidationError);
    });

    it('rejects role with negative max_tokens', () => {
      const data = { ...validRole, max_tokens: -100 };
      expect(() => validateStatic(roleSchema, data, 'r.yaml')).toThrow(StaticFileValidationError);
    });

    it('accepts role with multiple agreement_participation entries', () => {
      const data = {
        ...validRole,
        agreement_participation: [
          { agreement_type: 'consensus', action: 'vote' },
          { agreement_type: 'review', action: 'approve' },
        ],
      };
      expect(validateStatic(roleSchema, data, 'r.yaml').agreement_participation).toHaveLength(2);
    });

    it('rejects agreement_participation with empty strings', () => {
      const data = {
        ...validRole,
        agreement_participation: [{ agreement_type: '', action: 'vote' }],
      };
      expect(() => validateStatic(roleSchema, data, 'r.yaml')).toThrow(StaticFileValidationError);
    });
  });

  describe('governanceSchema edge cases', () => {
    const validGovernance = {
      iteration_limits: {
        max_review_iterations: 5,
        max_judge_arbitrations: 3,
        max_clarification_rounds: 3,
      },
      quality_gates: {
        specification_readiness: { min_completeness_score: 0.8 },
        implementation_review: {
          max_high_severity_findings: 0,
          max_medium_severity_findings: 3,
        },
      },
      budget: { max_tokens_per_run: null },
      permission_policy: {
        default_action: 'ask_human',
        role_trust: {},
        rules: [],
      },
    };

    it('accepts valid governance with null budget', () => {
      expect(validateStatic(governanceSchema, validGovernance, 'g.yaml')).toBeDefined();
    });

    it('accepts governance with positive budget', () => {
      const data = {
        ...validGovernance,
        budget: { max_tokens_per_run: 100000 },
      };
      expect(validateStatic(governanceSchema, data, 'g.yaml')).toBeDefined();
    });

    it('rejects min_completeness_score above 1', () => {
      const data = {
        ...validGovernance,
        quality_gates: {
          ...validGovernance.quality_gates,
          specification_readiness: { min_completeness_score: 1.5 },
        },
      };
      expect(() => validateStatic(governanceSchema, data, 'g.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects min_completeness_score below 0', () => {
      const data = {
        ...validGovernance,
        quality_gates: {
          ...validGovernance.quality_gates,
          specification_readiness: { min_completeness_score: -0.1 },
        },
      };
      expect(() => validateStatic(governanceSchema, data, 'g.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('accepts boundary values 0 and 1 for min_completeness_score', () => {
      for (const score of [0, 1]) {
        const data = {
          ...validGovernance,
          quality_gates: {
            ...validGovernance.quality_gates,
            specification_readiness: { min_completeness_score: score },
          },
        };
        expect(validateStatic(governanceSchema, data, 'g.yaml')).toBeDefined();
      }
    });

    it('rejects zero max_review_iterations', () => {
      const data = {
        ...validGovernance,
        iteration_limits: { ...validGovernance.iteration_limits, max_review_iterations: 0 },
      };
      expect(() => validateStatic(governanceSchema, data, 'g.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects negative max_high_severity_findings', () => {
      const data = {
        ...validGovernance,
        quality_gates: {
          ...validGovernance.quality_gates,
          implementation_review: {
            max_high_severity_findings: -1,
            max_medium_severity_findings: 3,
          },
        },
      };
      expect(() => validateStatic(governanceSchema, data, 'g.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('accepts permission rules with decision field', () => {
      const data = {
        ...validGovernance,
        permission_policy: {
          default_action: 'deny',
          role_trust: { implementer: 'high' },
          rules: [{ action: 'file_write', decision: 'grant', scope: '**/*' }],
        },
      };
      expect(validateStatic(governanceSchema, data, 'g.yaml')).toBeDefined();
    });
  });

  describe('workflowYamlSchema edge cases', () => {
    const validWorkflow = {
      name: 'test-workflow',
      version: '1.0.0',
      initial_state: 'START',
      terminal_states: ['DONE'],
      states: {
        START: { type: 'action', transitions: [{ target: 'DONE', trigger: 'completion' }] },
        DONE: { type: 'terminal' },
      },
    };

    it('accepts a minimal valid workflow', () => {
      expect(validateStatic(workflowYamlSchema, validWorkflow, 'w.yaml')).toBeDefined();
    });

    it('rejects workflow with empty name', () => {
      const data = { ...validWorkflow, name: '' };
      expect(() => validateStatic(workflowYamlSchema, data, 'w.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects workflow with empty terminal_states', () => {
      const data = { ...validWorkflow, terminal_states: [] };
      expect(() => validateStatic(workflowYamlSchema, data, 'w.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects workflow missing states', () => {
      const { states: _, ...noStates } = validWorkflow;
      expect(() => validateStatic(workflowYamlSchema, noStates, 'w.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects workflow missing initial_state', () => {
      const { initial_state: _, ...noInitial } = validWorkflow;
      expect(() => validateStatic(workflowYamlSchema, noInitial, 'w.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('accepts state with optional label and description', () => {
      const data = {
        ...validWorkflow,
        states: {
          START: {
            type: 'action',
            label: 'Start State',
            description: 'The beginning',
            transitions: [{ target: 'DONE', trigger: 'completion' }],
          },
          DONE: { type: 'terminal' },
        },
      };
      expect(validateStatic(workflowYamlSchema, data, 'w.yaml')).toBeDefined();
    });

    it('accepts state with entry_actions and exit_actions', () => {
      const data = {
        ...validWorkflow,
        states: {
          START: {
            type: 'action',
            entry_actions: [{ type: 'dispatch_worker', params: { role: 'planner' } }],
            exit_actions: [{ type: 'record_journal', params: { message: 'done' } }],
            transitions: [{ target: 'DONE', trigger: 'completion' }],
          },
          DONE: { type: 'terminal' },
        },
      };
      expect(validateStatic(workflowYamlSchema, data, 'w.yaml')).toBeDefined();
    });
  });
});
