import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  configSchema,
  governanceSchema,
  roleSchema,
  runnersSchema,
  StaticFileValidationError,
  validateStatic,
} from '../../schemas/static-schemas';
import { generateConfigYaml } from '../config-generator';
import { generateGovernanceYaml } from '../governance-generator';
import { generateRolesYaml } from '../roles-generator';
import { ALL_ROLE_IDS, generateTemplateFile } from '../templates-generator';
import { generateWorkflowYaml, getBuiltInWorkflowByName } from '../workflow-generator';

describe('config-generator', () => {
  it('produces valid YAML with runtime settings', () => {
    const yaml = generateConfigYaml();
    const parsed = parseYaml(yaml) as {
      log_level: string;
      runtime_root?: string;
    };
    expect(parsed.log_level).toBe('info');
    expect(parsed.runtime_root).toBeUndefined();
  });
});

describe('workflow-generator', () => {
  it('produces valid YAML for dev workflow', () => {
    const yaml = generateWorkflowYaml('dev');
    const parsed = parseYaml(yaml) as {
      name: string;
      version: string;
      initial_state: string;
      terminal_states: string[];
      states: Record<string, { type: string; transitions: unknown[] }>;
    };
    expect(parsed.name).toBe('dev');
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.initial_state).toBe('INTAKE');
    expect(parsed.terminal_states).toEqual(['DONE', 'FAILED', 'ABORTED']);
    expect(Object.keys(parsed.states)).toHaveLength(18);
    expect(parsed.states.INTAKE.type).toBe('action');
    expect(parsed.states.INTAKE.transitions).toHaveLength(4);
    expect(parsed.states.DONE.type).toBe('terminal');
  });

  it('produces valid YAML for pr-review workflow', () => {
    const yaml = generateWorkflowYaml('pr-review');
    const parsed = parseYaml(yaml) as {
      name: string;
      version: string;
      initial_state: string;
      terminal_states: string[];
      states: Record<string, { type: string; transitions: unknown[] }>;
    };
    expect(parsed.name).toBe('pr-review');
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.initial_state).toBe('SETUP');
    expect(parsed.terminal_states).toEqual(['DONE', 'FAILED', 'ABORTED']);
    expect(Object.keys(parsed.states)).toHaveLength(11);
  });

  it('throws on unknown workflow name', () => {
    expect(() => generateWorkflowYaml('nonexistent')).toThrow('Unknown workflow: nonexistent');
  });
});

describe('pr-review workflow structure', () => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const workflow = getBuiltInWorkflowByName('pr-review')!;

  it('loads successfully', () => {
    expect(workflow).toBeDefined();
  });

  it('has name and version', () => {
    expect(workflow.name).toBe('pr-review');
    expect(workflow.version).toBe('1.0.0');
  });

  it('starts at SETUP', () => {
    expect(workflow.initialState).toBe('SETUP');
  });

  it('has DONE, FAILED, and ABORTED as terminal states', () => {
    expect(workflow.terminalStates).toContain('DONE');
    expect(workflow.terminalStates).toContain('FAILED');
    expect(workflow.terminalStates).toContain('ABORTED');
    expect(workflow.terminalStates).toHaveLength(3);
  });

  it('defines exactly 11 states', () => {
    const stateIds = Object.keys(workflow.states);
    expect(stateIds).toHaveLength(11);
    expect(stateIds).toContain('SETUP');
    expect(stateIds).toContain('INTAKE');
    expect(stateIds).toContain('DIFF_COMPUTATION');
    expect(stateIds).toContain('REVIEW_EXECUTION');
    expect(stateIds).toContain('REVIEW_SYNTHESIS');
    expect(stateIds).toContain('WRAP_UP');
    expect(stateIds).toContain('PUBLISH_FINDINGS');
    expect(stateIds).toContain('CLEANUP');
    expect(stateIds).toContain('DONE');
    expect(stateIds).toContain('FAILED');
    expect(stateIds).toContain('ABORTED');
  });

  it('INTAKE dispatches context_analyst', () => {
    const intake = workflow.states['INTAKE'];
    const dispatchAction = intake.entryActions?.find((a) => a.type === 'dispatch_worker');
    expect(dispatchAction).toBeDefined();
    expect(dispatchAction?.params['role']).toBe('context_analyst');
  });

  it('does not have a JUDGE_REVIEW state', () => {
    expect(workflow.states).not.toHaveProperty('JUDGE_REVIEW');
  });

  it('REVIEW_EXECUTION uses dispatch_parallel_workers', () => {
    const reviewExecution = workflow.states['REVIEW_EXECUTION'];
    const parallelAction = reviewExecution.entryActions?.find(
      (a) => a.type === 'dispatch_parallel_workers',
    );
    expect(parallelAction).toBeDefined();
    const roles = parallelAction?.params['roles'] as string[];
    expect(roles).toContain('static_reviewer');
    expect(roles).toContain('design_reviewer');
    expect(roles).toContain('security_reviewer');
    expect(roles).toContain('performance_reviewer');
    expect(roles).toContain('adversarial_reviewer');
    expect(roles).toContain('docs_reviewer');
    expect(roles).toContain('ux_reviewer');
  });

  it('REVIEW_EXECUTION routes review_approved and review_rejected to REVIEW_SYNTHESIS', () => {
    const reviewExecution = workflow.states['REVIEW_EXECUTION'];
    const approved = reviewExecution.transitions.find((t) => t.trigger === 'review_approved');
    const rejected = reviewExecution.transitions.find((t) => t.trigger === 'review_rejected');
    expect(approved?.target).toBe('REVIEW_SYNTHESIS');
    expect(rejected?.target).toBe('REVIEW_SYNTHESIS');
  });

  it('REVIEW_EXECUTION handles iteration_exhausted by aborting', () => {
    const reviewExecution = workflow.states['REVIEW_EXECUTION'];
    const exhausted = reviewExecution.transitions.find((t) => t.trigger === 'iteration_exhausted');
    expect(exhausted?.target).toBe('ABORTED');
  });

  it('REVIEW_EXECUTION handles human_input by aborting', () => {
    const reviewExecution = workflow.states['REVIEW_EXECUTION'];
    const humanInput = reviewExecution.transitions.find((t) => t.trigger === 'human_input');
    expect(humanInput?.target).toBe('ABORTED');
  });

  it('routes failure triggers to FAILED, not ABORTED', () => {
    const actionStates = Object.entries(workflow.states).filter(
      ([id, s]) => s.type === 'action' && id !== 'CLEANUP',
    );
    for (const [id, state] of actionStates) {
      const failureTransition = state.transitions.find((t) => t.trigger === 'failure');
      expect(failureTransition?.target, `${id} failure should target FAILED`).toBe('FAILED');
    }
  });

  it('REVIEW_SYNTHESIS dispatches report_synthesizer', () => {
    const reviewSynthesis = workflow.states['REVIEW_SYNTHESIS'];
    const dispatchAction = reviewSynthesis.entryActions?.find((a) => a.type === 'dispatch_worker');
    expect(dispatchAction).toBeDefined();
    expect(dispatchAction?.params['role']).toBe('report_synthesizer');
  });

  it('REVIEW_SYNTHESIS guards on review_report artifact', () => {
    const reviewSynthesis = workflow.states['REVIEW_SYNTHESIS'];
    const completion = reviewSynthesis.transitions.find((t) => t.trigger === 'completion');
    expect(completion?.guards.length).toBeGreaterThanOrEqual(1);
    expect(completion?.guards[0].params['artifactType']).toBe('review_report');
  });

  it('terminal states have no outgoing transitions', () => {
    for (const terminalId of workflow.terminalStates) {
      const state = workflow.states[terminalId];
      expect(state.transitions).toHaveLength(0);
    }
  });

  it('every transition target references a valid state', () => {
    const stateIds = new Set(Object.keys(workflow.states));
    for (const state of Object.values(workflow.states)) {
      for (const transition of state.transitions) {
        expect(stateIds.has(transition.target)).toBe(true);
      }
    }
  });

  it('transitions are ordered by priority', () => {
    for (const state of Object.values(workflow.states)) {
      for (let i = 1; i < state.transitions.length; i++) {
        expect(state.transitions[i].priority).toBeGreaterThanOrEqual(
          state.transitions[i - 1].priority,
        );
      }
    }
  });
});

describe('roles-generator', () => {
  it('produces valid YAML with 20 unified role entries', () => {
    const yaml = generateRolesYaml();
    const parsed = parseYaml(yaml) as {
      roles: Array<{
        id: string;
        name: string;
        owned_artifacts: string[];
        readable_artifacts: string[];
        model: string;
        runner: string;
      }>;
    };
    expect(parsed.roles).toHaveLength(25);
    const analyst = parsed.roles.find((r) => r.id === 'requirements_analyst');
    expect(analyst?.name).toBe('Requirements Analyst');
    expect(analyst?.owned_artifacts).toContain('canonical_specification');
    expect(analyst?.readable_artifacts).toContain('canonical_specification');
    expect(analyst?.readable_artifacts).toContain('intake_requirements');
    expect(analyst?.model).toBe('gpt-5.4-high');
    expect(analyst?.runner).toBe('cursor');

    const contextAnalyst = parsed.roles.find((r) => r.id === 'context_analyst');
    expect(contextAnalyst?.name).toBe('Context Analyst');
    expect(contextAnalyst?.owned_artifacts).toContain('canonical_specification');

    const reportSynthesizer = parsed.roles.find((r) => r.id === 'report_synthesizer');
    expect(reportSynthesizer?.name).toBe('Report Synthesizer');
    expect(reportSynthesizer?.owned_artifacts).toContain('review_report');
  });
});

describe('governance-generator', () => {
  it('produces valid YAML with all governance sections', () => {
    const yaml = generateGovernanceYaml();
    const parsed = parseYaml(yaml) as {
      iteration_limits: { max_review_iterations: number };
      quality_gates: { specification_readiness: { min_completeness_score: number } };
      permission_policy: { default_action: string };
    };
    expect(parsed.iteration_limits.max_review_iterations).toBe(5);
    expect(parsed.quality_gates.specification_readiness.min_completeness_score).toBe(0.8);
    expect(parsed.permission_policy.default_action).toBe('ask_human');
  });
});

describe('templates-generator', () => {
  it('ALL_ROLE_IDS contains 25 role IDs', () => {
    expect(ALL_ROLE_IDS).toHaveLength(25);
    expect(ALL_ROLE_IDS).toContain('requirements_analyst');
    expect(ALL_ROLE_IDS).toContain('summary_writer');
    expect(ALL_ROLE_IDS).toContain('context_analyst');
    expect(ALL_ROLE_IDS).toContain('report_synthesizer');
    expect(ALL_ROLE_IDS).toContain('codebase_analyst');
    expect(ALL_ROLE_IDS).toContain('test_engineer');
    expect(ALL_ROLE_IDS).toContain('acceptance_validator');
    expect(ALL_ROLE_IDS).toContain('review_findings_writer');
    expect(ALL_ROLE_IDS).toContain('breakdown_analyst');
    expect(ALL_ROLE_IDS).toContain('decomposer');
    expect(ALL_ROLE_IDS).toContain('decomposition_reviewer');
    expect(ALL_ROLE_IDS).toContain('task_spec_writer');
  });

  it('generates valid frontmatter + body for requirements_analyst', () => {
    const content = generateTemplateFile('requirements_analyst');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('role: requirements_analyst');
    expect(content).toContain('version: 1.0.0');
    expect(content).toContain('artifact_type: canonical_specification');
    expect(content).toContain('artifact_type: intake_requirements');
    expect(content).toContain('name: previousSpecification');
    expect(content).toContain('{{previousSpecification}}');
    expect(content).toContain('format: json');
    expect(content).not.toContain('format: markdown_with_frontmatter');
    expect(content).toContain('You are the Requirements Analyst');
    expect(content).toContain('required fields');
    expect(content).toContain('{{>json_write_rules}}');
  });

  it('declares format: json for every role template', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const content = generateTemplateFile(roleId);
      expect(content).toContain('format: json');
      expect(content).not.toContain('format: markdown_with_frontmatter');
    }
  });

  it('generates template for every role ID', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const content = generateTemplateFile(roleId);
      expect(content).toContain(`role: ${roleId}`);
    }
  });

  it('adds bounded execution contracts to the highest-impact prompt targets', () => {
    const expectations = [
      {
        roleId: 'context_analyst',
        markers: [
          '## Execution Contract',
          'Fetch the minimum authoritative source set',
          'Clarify before broad hunting',
          'Prioritize exact artifacts over discovery',
        ],
      },
      {
        roleId: 'codebase_analyst',
        markers: [
          '## Execution Contract',
          'Start from the smallest confirmed target',
          'Cap representative file reads',
          'Clarify before repo-wide archaeology',
        ],
      },
      {
        roleId: 'planner',
        markers: [
          '## Execution Contract',
          'Anchor on exact inputs first',
          'Clarify before broad planning',
          'Keep the first-pass plan concise but concrete',
        ],
      },
      {
        roleId: 'implementer',
        markers: [
          '## Execution Contract',
          'Execute the plan, not a repo exploration',
          'Clarify before improvising',
          'Keep the implementation artifact focused on completed plan steps',
        ],
      },
      {
        roleId: 'verifier',
        markers: [
          '## Execution Contract',
          'Start from exact targets',
          'Clarify before repo-wide sweeps',
          'Preserve evidence discipline',
        ],
      },
    ] as const;

    for (const expectation of expectations) {
      const content = generateTemplateFile(expectation.roleId);
      for (const marker of expectation.markers) {
        expect(content).toContain(marker);
      }
    }
  });
});

describe('static-schemas', () => {
  describe('validateStatic', () => {
    it('returns parsed data on valid input', () => {
      const data = {
        log_level: 'info',
        default_workflow: 'dev',
        workflow_version: '1.0',
        global_transition_limit: 200,
      };
      const result = validateStatic(configSchema, data, 'config.yaml');
      expect(result).toEqual(data);
    });

    it('throws StaticFileValidationError with path details on invalid input', () => {
      const data = { log_level: 'invalid_level' };
      expect(() => validateStatic(configSchema, data, 'config.yaml')).toThrow(
        StaticFileValidationError,
      );
      try {
        validateStatic(configSchema, data, 'config.yaml');
      } catch (e) {
        const err = e as StaticFileValidationError;
        expect(err.file).toBe('config.yaml');
        expect(err.issues.length).toBeGreaterThan(0);
        expect(err.message).toContain('config.yaml');
      }
    });
  });

  describe('configSchema', () => {
    it('rejects missing required fields', () => {
      expect(() => validateStatic(configSchema, {}, 'config.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects invalid log_level', () => {
      const data = {
        log_level: 'trace',
        default_workflow: 'dev',
        workflow_version: '1.0',
        global_transition_limit: 200,
      };
      expect(() => validateStatic(configSchema, data, 'config.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects non-positive global_transition_limit', () => {
      const data = {
        log_level: 'info',
        default_workflow: 'dev',
        workflow_version: '1.0',
        global_transition_limit: 0,
      };
      expect(() => validateStatic(configSchema, data, 'config.yaml')).toThrow(
        StaticFileValidationError,
      );
    });
  });

  describe('runnersSchema', () => {
    it('accepts valid runners', () => {
      const data = {
        runners: [{ id: 'test', name: 'Test', models: ['model-1'] }],
      };
      expect(validateStatic(runnersSchema, data, 'runners.yaml')).toEqual(data);
    });

    it('rejects runner with empty models', () => {
      const data = { runners: [{ id: 'test', name: 'Test', models: [] }] };
      expect(() => validateStatic(runnersSchema, data, 'runners.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects empty runners array', () => {
      expect(() => validateStatic(runnersSchema, { runners: [] }, 'runners.yaml')).toThrow(
        StaticFileValidationError,
      );
    });
  });

  describe('roleSchema', () => {
    const validRole = {
      id: 'test_role',
      name: 'Test Role',
      description: 'A test role',
      owned_artifacts: ['test_artifact'],
      readable_artifacts: [],
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

    it('accepts a valid role', () => {
      expect(validateStatic(roleSchema, validRole, 'roles/test.yaml')).toEqual(validRole);
    });

    it('rejects role with empty required_capabilities', () => {
      const data = { ...validRole, required_capabilities: [] };
      expect(() => validateStatic(roleSchema, data, 'roles/test.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects role with invalid dispatch_type', () => {
      const data = { ...validRole, dispatch_type: 'batch' };
      expect(() => validateStatic(roleSchema, data, 'roles/test.yaml')).toThrow(
        StaticFileValidationError,
      );
    });
  });

  describe('governanceSchema', () => {
    it('rejects governance missing required sections', () => {
      expect(() => validateStatic(governanceSchema, {}, 'governance.yaml')).toThrow(
        StaticFileValidationError,
      );
    });

    it('rejects invalid governance data', () => {
      const data = {
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
        budget: { max_tokens_per_run: null },
        permission_policy: { default_action: 'invalid_action', role_trust: {}, rules: [] },
      };
      expect(() => validateStatic(governanceSchema, data, 'governance.yaml')).toThrow(
        StaticFileValidationError,
      );
    });
  });
});
