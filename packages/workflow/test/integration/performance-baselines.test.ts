import { InMemoryEventBus } from '@ai-dev-orchestrator/core';
import { DefaultDependencyGraph } from '@ai-dev-orchestrator/dependency-graph';
import { DefaultPolicyRegistry } from '@ai-dev-orchestrator/policy-engine';
import { DefaultTemplateRegistry, DefaultTokenEstimator } from '@ai-dev-orchestrator/prompt-engine';
import type {
  EventSource,
  EventType,
  PolicyDefinition,
  PromptTemplate,
} from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { WorkflowParser } from '@ai-dev-orchestrator/workflow';

function measure(
  fn: () => void,
  iterations: number = 100,
  warmup: number = 10,
): { meanMs: number; p95Ms: number } {
  for (let i = 0; i < warmup; i++) {
    fn();
  }
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)] ?? mean;
  return { meanMs: mean, p95Ms: p95 };
}

describe('performance baselines', () => {
  describe('event system throughput', () => {
    it('publishes 1000 events in under 100ms', () => {
      const bus = new InMemoryEventBus({ runId: 'bench-run' });
      let count = 0;
      bus.subscribe(
        { types: ['workflow:started' as EventType] },
        () => {
          count++;
        },
        { mode: 'sync' },
      );

      const source: EventSource = 'system';
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        bus.publish({
          type: 'workflow:started' as EventType,
          source,
          data: { runId: `run-${String(i)}` },
        });
      }
      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(500);
    });

    it('fan-out to 10 subscribers under 50ms for 100 events', () => {
      const bus = new InMemoryEventBus({ runId: 'bench-run' });
      let total = 0;
      for (let s = 0; s < 10; s++) {
        bus.subscribe(
          { types: ['workflow:started' as EventType] },
          () => {
            total++;
          },
          { mode: 'sync' },
        );
      }

      const source: EventSource = 'system';
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        bus.publish({
          type: 'workflow:started' as EventType,
          source,
          data: { runId: `run-${String(i)}` },
        });
      }
      const elapsed = performance.now() - start;

      expect(total).toBe(1000);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('workflow DSL parsing', () => {
    it('parses default workflow under 5ms mean', () => {
      const parser = new WorkflowParser();
      const defaultYaml = `
name: default
version: "1.0.0"
initialState: INTAKE
terminalStates:
  - DONE
  - ABORTED
states:
  INTAKE:
    type: action
  PLANNING:
    type: action
  DONE:
    type: terminal
`;
      const result = measure(() => {
        parser.parse(defaultYaml);
      });

      expect(result.meanMs).toBeLessThan(15);
      expect(result.p95Ms).toBeLessThan(100);
    });
  });

  describe('policy evaluation', () => {
    it('evaluates built-in policies under 1ms mean', () => {
      const registry = new DefaultPolicyRegistry();

      const policy: PolicyDefinition = {
        id: 'iteration_limit',
        type: 'iteration_limit',
        scope: {},
        config: {
          maxReviewIterations: 5,
          maxJudgeArbitrations: 3,
          maxClarificationRounds: 2,
          maxAcceptanceIterations: 3,
        },
        enabled: true,
      };

      const evaluator = registry.getEvaluator('iteration_limit');
      const result = measure(() => {
        evaluator.evaluate(policy, {
          runId: 'bench-run',
          currentState: 'IMPLEMENTATION',
          artifacts: [],
          iterationCount: 1,
        });
      });

      expect(result.meanMs).toBeLessThan(1);
    });
  });

  describe('dependency graph operations', () => {
    it('constructs default graph and queries dependencies under 5ms', () => {
      const result = measure(() => {
        const graph = new DefaultDependencyGraph();
        graph.getDependencies('implementation');
        graph.getDependents('canonical_specification');
        graph.validate();
      });

      expect(result.meanMs).toBeLessThan(5);
    });
  });

  describe('template rendering', () => {
    it('registers and retrieves 7 role templates under 2ms', () => {
      const roles = [
        'requirements_analyst',
        'planner',
        'implementer',
        'static_reviewer',
        'security_reviewer',
        'performance_reviewer',
        'verifier',
      ];

      const result = measure(() => {
        const registry = new DefaultTemplateRegistry();
        for (const role of roles) {
          const template: PromptTemplate = {
            body: `You are a ${role}. Analyze the following: {{task}}`,
            source: 'test',
            frontmatter: {
              role,
              version: '1.0.0',
              description: `${role} template`,
              variables: [
                { name: 'task', type: 'literal', required: true, description: 'The task' },
              ],
              outputContract: {
                role,
                artifactType: 'implementation' as const,
                schema: {},
                format: 'freeform' as const,
                required: true,
                repairEnabled: false,
                maxRepairAttempts: 0,
              },
            },
          };
          registry.register(template);
        }
        for (const role of roles) {
          registry.resolve(role);
        }
      });

      expect(result.meanMs).toBeLessThan(2);
    });
  });

  describe('token estimation', () => {
    it('estimates tokens for 10KB text under 2ms', () => {
      const estimator = new DefaultTokenEstimator();
      const text = 'a'.repeat(10 * 1024);

      const result = measure(() => {
        estimator.estimate(text);
      });

      expect(result.meanMs).toBeLessThan(2);
    });
  });
});
