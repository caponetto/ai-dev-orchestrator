import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OwnershipViolationError,
  DefaultArtifactTypeValidator,
  DefaultOwnershipRegistry,
  FilesystemArtifactStore,
} from '@ai-orchestrator/artifacts';
import { DefaultRoleRegistry } from '@ai-orchestrator/role-system';
import type { ArtifactRef, Event } from '@ai-orchestrator/schemas';
import { describe, expect, it, vi } from 'vitest';

import { FileSystemConfigurationLoader } from '../../src/infrastructure/configuration/configuration-loader';
import { InMemoryEventBus } from '../../src/infrastructure/event-system/in-memory-event-bus';
import { TEST_ROLES } from '../fixtures/test-defaults';

function writeMinimalAiConfig(aiDir: string): void {
  mkdirSync(aiDir, { recursive: true });
  writeFileSync(join(aiDir, 'config.yaml'), 'log_level: info\n', 'utf-8');
  writeFileSync(join(aiDir, 'workflow.yaml'), 'name: dev\nversion: "1.0.0"\n', 'utf-8');
  writeFileSync(
    join(aiDir, 'roles.yaml'),
    'roles:\n  - id: planner\n    model: claude-opus-4-6\n    dispatch_type: agent\n',
    'utf-8',
  );
  writeFileSync(
    join(aiDir, 'governance.yaml'),
    [
      'iteration_limits:',
      '  max_review_iterations: 2',
      '  max_judge_arbitrations: 1',
      '  max_clarification_rounds: 3',
      'quality_gates:',
      '  specification_readiness:',
      '    min_completeness_score: 0.8',
      '  implementation_review:',
      '    max_high_severity_findings: 0',
      '    max_medium_severity_findings: 3',
    ].join('\n'),
    'utf-8',
  );
}

function createRunDir(): string {
  return mkdtempSync(join(tmpdir(), 'ic1-'));
}

const VALID_SPEC_CONTENT = [
  '---',
  'id: spec-001',
  'version: 1',
  'title: Test Specification',
  'businessGoal: Validate IC-1 checkpoint',
  'createdAt: "2025-01-15T10:00:00Z"',
  'updatedAt: "2025-01-15T10:00:00Z"',
  '---',
  '# Test Spec',
  'This is a test.',
].join('\n');

const VALID_PLAN_CONTENT = JSON.stringify({
  version: 1,
  specificationRef: {
    type: 'canonical_specification',
    name: 'spec',
    version: 1,
    checksum: 'sha256:abc',
  },
  createdAt: '2025-01-15T10:00:00Z',
  summary: 'Plan steps here',
  tasks: [
    { taskId: 'task-1', description: 'Steps here', files: ['src/main.ts'], dependencies: [] },
  ],
});

describe('IC-1 Checkpoint: Artifacts persist, events flow, config loads', () => {
  it('store artifact, publish event, verify config provides ownership', async () => {
    const runDir = createRunDir();
    const runId = 'run-ic1-001';

    const registry = new DefaultRoleRegistry(TEST_ROLES, {
      assignments: {},
      defaultAssignment: { model: 'claude-opus-4-6' },
    });

    const ownershipRegistry = new DefaultOwnershipRegistry();
    const typeValidator = new DefaultArtifactTypeValidator();
    const store = new FilesystemArtifactStore(runDir, runId, ownershipRegistry, typeValidator);

    const eventBus = new InMemoryEventBus({ runId });

    const receivedEvents: Event[] = [];
    eventBus.subscribe({ types: ['artifact.stored'] }, (event) => {
      receivedEvents.push(event);
    });

    const ref = await store.store({
      type: 'canonical_specification',
      name: 'test-spec',
      content: VALID_SPEC_CONTENT,
      producedBy: 'requirements_analyst',
    });

    eventBus.publish({
      type: 'artifact.stored',
      source: 'artifact_system',
      data: {
        artifactRef: ref,
        producedBy: 'requirements_analyst',
        sizeBytes: Buffer.byteLength(VALID_SPEC_CONTENT, 'utf-8'),
      },
    });

    expect(ref.type).toBe('canonical_specification');
    expect(ref.name).toBe('test-spec');
    expect(ref.version).toBe(1);
    expect(ref.checksum).toMatch(/^sha256:/);

    const retrieved = await store.get(ref);
    expect(retrieved.content).toBe(VALID_SPEC_CONTENT);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('artifact.stored');

    expect(ownershipRegistry.isAuthorized('requirements_analyst', 'canonical_specification')).toBe(
      true,
    );
    expect(ownershipRegistry.isAuthorized('planner', 'canonical_specification')).toBe(false);

    const role = registry.getRole('requirements_analyst');
    expect(role).not.toBeNull();
    expect(role?.ownedArtifacts).toContain('canonical_specification');
  });

  it('config loads and provides role assignments used by artifact ownership', () => {
    const runDir = createRunDir();
    const aiDir = join(runDir, '.ai');
    writeMinimalAiConfig(aiDir);

    const loader = new FileSystemConfigurationLoader();
    const config = loader.load({ aiConfigDir: aiDir });

    expect(config.roles.assignments['planner']).toBeDefined();

    const registry = new DefaultRoleRegistry(TEST_ROLES, {
      assignments: {
        planner: { model: 'claude-opus-4-6' },
      },
      defaultAssignment: { model: 'claude-opus-4-6' },
    });

    const assignment = registry.getModelAssignment('planner');
    expect(assignment.roleId).toBe('planner');
    expect(assignment.model).toBe('claude-opus-4-6');

    const validation = registry.validate();
    expect(validation.valid).toBe(true);
  });

  it('authorized role stores, unauthorized role rejected', async () => {
    const runDir = createRunDir();
    const ownershipRegistry = new DefaultOwnershipRegistry();
    const typeValidator = new DefaultArtifactTypeValidator();
    const store = new FilesystemArtifactStore(
      runDir,
      'run-ic1-002',
      ownershipRegistry,
      typeValidator,
    );

    const ref = await store.store({
      type: 'plan',
      name: 'test-plan',
      content: VALID_PLAN_CONTENT,
      producedBy: 'planner',
    });
    expect(ref.version).toBe(1);

    await expect(
      store.store({
        type: 'plan',
        name: 'unauthorized-plan',
        content: VALID_PLAN_CONTENT,
        producedBy: 'implementer',
      }),
    ).rejects.toThrow(OwnershipViolationError);
  });

  it('artifact integrity survives round-trip', async () => {
    const runDir = createRunDir();
    const ownershipRegistry = new DefaultOwnershipRegistry();
    const typeValidator = new DefaultArtifactTypeValidator();
    const store = new FilesystemArtifactStore(
      runDir,
      'run-ic1-003',
      ownershipRegistry,
      typeValidator,
    );

    const ref = await store.store({
      type: 'canonical_specification',
      name: 'integrity-test',
      content: VALID_SPEC_CONTENT,
      producedBy: 'requirements_analyst',
    });

    const integrity = await store.verify(ref);
    expect(integrity.valid).toBe(true);
    expect(integrity.expectedChecksum).toBe(integrity.actualChecksum);
  });

  it('event bus delivers events across subsystem boundaries', async () => {
    const eventBus = new InMemoryEventBus({ runId: 'run-ic1-events' });

    const artifactEvents: Event[] = [];
    const runEvents: Event[] = [];

    eventBus.subscribe({ types: ['artifact.stored'] }, (event) => {
      artifactEvents.push(event);
    });
    eventBus.subscribe({ types: ['run.started'] }, (event) => {
      runEvents.push(event);
    });

    const ref: ArtifactRef = {
      type: 'plan',
      name: 'test',
      version: 1,
      checksum: 'sha256:abc',
    };

    eventBus.publish({
      type: 'run.started',
      source: 'runner_system',
      data: {
        config: { workflow: 'default', repository: '/tmp/test', sourceType: 'local' },
      },
    });

    eventBus.publish({
      type: 'artifact.stored',
      source: 'artifact_system',
      data: { artifactRef: ref, producedBy: 'planner', sizeBytes: 100 },
    });

    await vi.waitFor(() => {
      expect(runEvents).toHaveLength(1);
      expect(artifactEvents).toHaveLength(1);
    });
    expect(runEvents[0].runId).toBe('run-ic1-events');
    expect(artifactEvents[0].runId).toBe('run-ic1-events');
  });
});
