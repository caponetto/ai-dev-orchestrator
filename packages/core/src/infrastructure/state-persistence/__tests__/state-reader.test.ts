import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { readState, readStateRaw } from '../state-reader';

const TEST_DIR = join(tmpdir(), `state-reader-test-${String(Date.now())}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readState', () => {
  it('returns null when file does not exist', () => {
    expect(readState(join(TEST_DIR, 'missing.yaml'))).toBeNull();
  });

  it('parses valid YAML state file', () => {
    const state = {
      runId: 'run-001',
      schemaVersion: 1,
      currentState: 'PLANNING',
      previousState: 'INTAKE',
      stateEnteredAt: '2026-01-01T00:00:00Z',
      transitionCount: 2,
      stateHistory: ['INTAKE', 'PLANNING'],
      iterationCounts: {},
      activeArtifacts: [],
      lastProducedArtifact: null,
      workflowName: 'default',
      workflowVersion: '1.0.0',
      persistedAt: '2026-01-01T00:00:00Z',
      persistenceVersion: 1,
      checksum: 'sha256:abc',
    };
    const filePath = join(TEST_DIR, 'state.yaml');
    writeFileSync(filePath, stringify(state), 'utf8');

    const result = readState(filePath);
    expect(result).not.toBeNull();
    expect(result?.runId).toBe('run-001');
    expect(result?.currentState).toBe('PLANNING');
  });

  it('throws on invalid YAML', () => {
    const filePath = join(TEST_DIR, 'bad.yaml');
    writeFileSync(filePath, '{{invalid', 'utf8');
    expect(() => readState(filePath)).toThrow();
  });

  it('throws StatePersistenceError for non-object YAML content', () => {
    const filePath = join(TEST_DIR, 'scalar.yaml');
    writeFileSync(filePath, '"just a string"', 'utf8');
    expect(() => readState(filePath)).toThrow('Invalid state file: expected object');
  });

  it('throws StatePersistenceError when runId is missing', () => {
    const filePath = join(TEST_DIR, 'no-runid.yaml');
    writeFileSync(filePath, stringify({ currentState: 'PLANNING', other: 'data' }), 'utf8');
    expect(() => readState(filePath)).toThrow('missing required fields');
  });

  it('throws StatePersistenceError when currentState is missing', () => {
    const filePath = join(TEST_DIR, 'no-state.yaml');
    writeFileSync(filePath, stringify({ runId: 'run-001', other: 'data' }), 'utf8');
    expect(() => readState(filePath)).toThrow('missing required fields');
  });
});

describe('readStateRaw', () => {
  it('returns null when file does not exist', () => {
    expect(readStateRaw(join(TEST_DIR, 'missing.yaml'))).toBeNull();
  });

  it('returns raw content', () => {
    const filePath = join(TEST_DIR, 'raw.yaml');
    writeFileSync(filePath, 'runId: run-001', 'utf8');
    expect(readStateRaw(filePath)).toBe('runId: run-001');
  });
});
