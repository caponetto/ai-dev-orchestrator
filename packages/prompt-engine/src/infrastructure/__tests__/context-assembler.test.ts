import type { AssemblyRequest } from '@ai-dev-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import { ContextAssembler } from '../context-assembler';
import { DefaultTokenEstimator } from '../default-token-estimator';

function makeRequest(): AssemblyRequest {
  return {
    role: {
      id: 'architect',
      name: 'architect',
      description: 'Reviews architecture',
      ownedArtifacts: ['static_review'],
      readableArtifacts: ['implementation', 'plan'],
      forbiddenArtifacts: ['verification'],
      reviewedBy: [],
      reviews: [],
      agreementParticipation: [],
      requiredCapabilities: ['code_generation', 'reasoning'],
      dispatchType: 'agent',
    },
    inputArtifacts: [
      {
        ref: { type: 'implementation', name: 'src-1', version: 1, checksum: 'abc123' },
        content: 'const x = 1;',
      },
    ],
    constraints: {
      maxOutputTokens: 4000,
      timeout: 30000,
      requiredOutputType: 'static_review',
    },
    systemContext: {
      runId: 'run-123',
      currentState: 'analyzing',
      iterationCount: 1,
    },
    tokenBudget: {
      maxInputTokens: 100000,
      reservedOutputTokens: 4000,
      artifactPriority: [],
    },
  };
}

describe('ContextAssembler', () => {
  it('assembles a complete prompt context', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.role.name).toBe('architect');
    expect(result.role.description).toBe('Reviews architecture');
    expect(result.role.ownedArtifacts).toEqual(['static_review']);
    expect(result.role.forbiddenArtifacts).toEqual(['verification']);
  });

  it('builds artifact blocks with token estimates', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].content).toBe('const x = 1;');
    expect(result.artifacts[0].tokenEstimate).toBeGreaterThan(0);
    expect(result.artifacts[0].ref.type).toBe('implementation');
  });

  it('builds task block from constraints', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.task.requiredOutputType).toBe('static_review');
    expect(result.task.constraints).toContain('4000');
    expect(result.task.constraints).toContain('30000');
  });

  it('builds rules block with role rules', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.rules.rules.length).toBeGreaterThan(0);
    expect(result.rules.rules.some((r) => r.includes('architect'))).toBe(true);
    expect(result.rules.rules.some((r) => r.includes('verification'))).toBe(true);
  });

  it('builds system info block', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.systemInfo.runId).toBe('run-123');
    expect(result.systemInfo.currentState).toBe('analyzing');
    expect(result.systemInfo.iterationCount).toBe(1);
    expect(result.systemInfo.timestamp).toBeTruthy();
  });

  it('calculates total token estimate', () => {
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(makeRequest());

    expect(result.totalTokenEstimate).toBeGreaterThan(0);
  });

  it('handles empty forbidden artifacts', () => {
    const request = makeRequest();
    const modified: AssemblyRequest = {
      ...request,
      role: { ...request.role, forbiddenArtifacts: [] },
    };
    const assembler = new ContextAssembler(new DefaultTokenEstimator());
    const result = assembler.assemble(modified);

    expect(result.rules.rules.every((r) => !r.includes('must NOT produce'))).toBe(true);
  });

  describe('system instruction injection', () => {
    it('injects organization system instructions into rules', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.addSystemInstruction({
        source: 'organization',
        content: 'All outputs must comply with HIPAA regulations.',
      });

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).toContain('All outputs must comply with HIPAA regulations.');
    });

    it('injects project system instructions into rules', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.addSystemInstruction({
        source: 'project',
        content: 'Use TypeScript strict mode.',
      });

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).toContain('Use TypeScript strict mode.');
    });

    it('system instructions appear before role rules', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.addSystemInstruction({
        source: 'organization',
        content: 'ORG_INSTRUCTION',
      });

      const result = assembler.assemble(makeRequest());
      const orgIdx = result.rules.rules.indexOf('ORG_INSTRUCTION');
      const roleIdx = result.rules.rules.findIndex((r) => r.includes('architect'));
      expect(orgIdx).toBeLessThan(roleIdx);
    });

    it('supports multiple system instructions', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.addSystemInstruction({ source: 'organization', content: 'Org rule 1' });
      assembler.addSystemInstruction({ source: 'project', content: 'Project rule 1' });

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).toContain('Org rule 1');
      expect(result.rules.rules).toContain('Project rule 1');
    });

    it('clearSystemInstructions removes all injected instructions', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.addSystemInstruction({ source: 'organization', content: 'Temporary rule' });
      assembler.clearSystemInstructions();

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).not.toContain('Temporary rule');
    });
  });

  describe('prompt structure optimization', () => {
    it('orders return fields stable-first then volatile-last', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      const result = assembler.assemble(makeRequest());

      const keys = Object.keys(result);
      const systemInfoIdx = keys.indexOf('systemInfo');
      const roleIdx = keys.indexOf('role');
      const rulesIdx = keys.indexOf('rules');
      const outputFormatIdx = keys.indexOf('outputFormat');
      const artifactsIdx = keys.indexOf('artifacts');
      const taskIdx = keys.indexOf('task');

      // Stable prefix comes first
      expect(systemInfoIdx).toBeLessThan(artifactsIdx);
      expect(roleIdx).toBeLessThan(artifactsIdx);
      expect(rulesIdx).toBeLessThan(artifactsIdx);
      expect(outputFormatIdx).toBeLessThan(artifactsIdx);

      // Volatile suffix comes last
      expect(artifactsIdx).toBeLessThan(taskIdx);
    });

    it('produces identical stable prefix across iterations with different findings', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());

      const request1 = makeRequest();
      const request2: AssemblyRequest = {
        ...makeRequest(),
        systemContext: {
          ...makeRequest().systemContext,
          iterationCount: 2,
          humanFeedback: 'fix the naming',
        },
      };

      const result1 = assembler.assemble(request1);
      const result2 = assembler.assemble(request2);

      // Role, rules, and outputFormat should be identical
      expect(result1.role).toEqual(result2.role);
      expect(result1.rules).toEqual(result2.rules);
      expect(result1.outputFormat).toEqual(result2.outputFormat);
    });
  });

  describe('token budget integration', () => {
    it('returns truncations array', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      const result = assembler.assemble(makeRequest());
      expect(Array.isArray(result.truncations)).toBe(true);
    });

    it('truncates artifacts when exceeding budget', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      const request = makeRequest();
      const largeContent = 'x '.repeat(50000);
      const modified: AssemblyRequest = {
        ...request,
        inputArtifacts: [
          {
            ref: { type: 'implementation', name: 'big-file', version: 1, checksum: 'hash' },
            content: largeContent,
          },
        ],
        tokenBudget: {
          maxInputTokens: 1000,
          reservedOutputTokens: 200,
          artifactPriority: [
            { artifactType: 'implementation', priority: 1, truncationStrategy: 'tail' },
          ],
        },
      };

      const result = assembler.assemble(modified);
      expect(result.truncations.length).toBeGreaterThan(0);
      expect(result.totalTokenEstimate).toBeLessThanOrEqual(1000);
    });
  });

  describe('project context integration', () => {
    it('includes project context fragments in rules when set', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.setProjectContextFragments([
        {
          category: 'codebase',
          content: '## Architecture\nHexagonal monorepo with strict layering.',
          relevanceScore: 1.0,
        },
      ]);

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).toContain('## Project Context');
      expect(result.rules.rules.some((r) => r.includes('Hexagonal monorepo'))).toBe(true);
    });

    it('assembles without project context when fragments are empty', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules).not.toContain('## Project Context');
    });

    it('clearProjectContext removes injected fragments', () => {
      const assembler = new ContextAssembler(new DefaultTokenEstimator());
      assembler.setProjectContextFragments([
        {
          category: 'codebase',
          content: 'Temporary context',
          relevanceScore: 1.0,
        },
      ]);
      assembler.clearProjectContext();

      const result = assembler.assemble(makeRequest());
      expect(result.rules.rules.every((r) => !r.includes('Temporary context'))).toBe(true);
    });
  });
});
