import type { ResolvedArtifact, RoleContract, WorkerConstraints } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { AgentTaskAssembler } from '../agent-task-assembler';

function makeRole(): RoleContract {
  return {
    id: 'implementer',
    name: 'implementer',
    description: 'Implements code changes',
    ownedArtifacts: ['implementation'],
    readableArtifacts: ['plan'],
    forbiddenArtifacts: [],
    reviewedBy: ['static_reviewer'],
    reviews: [],
    agreementParticipation: [],
    requiredCapabilities: [],
    dispatchType: 'agent',
    runner: 'claude-code',
  };
}

function makeConstraints(): WorkerConstraints {
  return {
    maxOutputTokens: 4096,
    timeout: 60000,
    requiredOutputType: 'implementation',
  };
}

describe('AgentTaskAssembler', () => {
  it('assembles an AgentTask from role and constraints', () => {
    const assembler = new AgentTaskAssembler();
    const artifacts: ResolvedArtifact[] = [
      {
        ref: { type: 'plan', name: 'plan-1', version: 1, checksum: 'abc' },
        content: 'implement feature X',
      },
    ];

    const task = assembler.assemble({
      taskId: 'worker-1',
      role: makeRole(),
      inputArtifacts: artifacts,
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: '20260101-000000-abc123',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.taskId).toBe('worker-1');
    expect(task.runId).toBe('20260101-000000-abc123');
    expect(task.stateId).toBe('IMPLEMENTATION');
    expect(task.role).toBe('implementer');
    expect(task.description).toBe('Implements code changes');
    expect(task.inputArtifacts).toHaveLength(1);
    expect(task.repoRoot).toBe('/repo');
    expect(task.runDir).toBe('.ai/runs/run-1');
    expect(task.outputArtifactPath).toBe('.ai/runs/run-1/artifacts/implementation-worker-1.json');
    expect(task.constraints.timeout).toBe(60000);
    expect(task.constraints.requiredOutputType).toBe('implementation');
  });

  it('uses agentConfig.timeoutMs over workerConstraints.timeout', () => {
    const assembler = new AgentTaskAssembler();
    const role = { ...makeRole(), agentConfig: { timeoutMs: 300000 } };

    const task = assembler.assemble({
      taskId: 'worker-3',
      role,
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.constraints.timeout).toBe(300000);
  });

  it('falls back to workerConstraints.timeout when agentConfig.timeoutMs is absent', () => {
    const assembler = new AgentTaskAssembler();

    const task = assembler.assemble({
      taskId: 'worker-4',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.constraints.timeout).toBe(60000);
  });

  it('extracts instructions from agentConfig', () => {
    const assembler = new AgentTaskAssembler();
    const role = {
      ...makeRole(),
      agentConfig: { instructions: 'Never run git stash or destructive git commands.' },
    };

    const task = assembler.assemble({
      taskId: 'worker-5',
      role,
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.instructions).toBe('Never run git stash or destructive git commands.');
  });

  it('instructions is undefined when not set in agentConfig', () => {
    const assembler = new AgentTaskAssembler();

    const task = assembler.assemble({
      taskId: 'worker-6',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.instructions).toBeUndefined();
  });

  it('passes output schema from worker constraints', () => {
    const assembler = new AgentTaskAssembler();
    const constraints: WorkerConstraints = {
      ...makeConstraints(),
      outputSchema: { type: 'object', properties: { files: { type: 'array' } } },
      outputFormat: 'json',
    };

    const task = assembler.assemble({
      taskId: 'worker-2',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: constraints,
      repoRoot: '/repo',
      runDir: '.ai/runs',
      runId: 'run-1',
      stateId: 'STATE',
    });

    expect(task.constraints.outputSchema).toEqual({
      type: 'object',
      properties: { files: { type: 'array' } },
    });
    expect(task.constraints.outputFormat).toBe('json');
  });

  it('chooses output path extension from outputFormat', () => {
    const assembler = new AgentTaskAssembler();

    const mdTask = assembler.assemble({
      taskId: 'worker-md',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: { ...makeConstraints(), outputFormat: 'markdown_with_frontmatter' },
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'STATE',
    });
    expect(mdTask.outputArtifactPath).toBe('.ai/runs/run-1/artifacts/implementation-worker-md.md');

    const yamlTask = assembler.assemble({
      taskId: 'worker-yaml',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: { ...makeConstraints(), outputFormat: 'yaml' },
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'STATE',
    });
    expect(yamlTask.outputArtifactPath).toBe(
      '.ai/runs/run-1/artifacts/implementation-worker-yaml.yaml',
    );
  });

  it('includes previousFindings and iterationCount when provided', () => {
    const assembler = new AgentTaskAssembler();
    const findings =
      '{"approved":false,"findings":[{"severity":"high","title":"Missing error handling"}]}';

    const task = assembler.assemble({
      taskId: 'worker-7',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
      previousFindings: findings,
      iterationCount: 3,
    });

    expect(task.previousFindings).toBe(findings);
    expect(task.iterationCount).toBe(3);
  });

  it('previousFindings and iterationCount are undefined when not provided', () => {
    const assembler = new AgentTaskAssembler();

    const task = assembler.assemble({
      taskId: 'worker-8',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.previousFindings).toBeUndefined();
    expect(task.iterationCount).toBeUndefined();
  });

  it('passes rolePrompt through to the assembled task', () => {
    const assembler = new AgentTaskAssembler();
    const rendered = 'You are the implementer. Follow the plan step by step.';

    const task = assembler.assemble({
      taskId: 'worker-9',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
      rolePrompt: rendered,
    });

    expect(task.rolePrompt).toBe(rendered);
  });

  it('rolePrompt is undefined when not provided', () => {
    const assembler = new AgentTaskAssembler();

    const task = assembler.assemble({
      taskId: 'worker-10',
      role: makeRole(),
      inputArtifacts: [],
      workerConstraints: makeConstraints(),
      repoRoot: '/repo',
      runDir: '.ai/runs/run-1',
      runId: 'run-1',
      stateId: 'IMPLEMENTATION',
    });

    expect(task.rolePrompt).toBeUndefined();
  });
});
