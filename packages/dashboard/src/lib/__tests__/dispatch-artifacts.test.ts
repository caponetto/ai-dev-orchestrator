import type { ArtifactEntryView } from '@ai-orchestrator/schemas';
import { describe, expect, it } from 'vitest';

import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';
import type { DispatchArtifacts } from '../dispatch-artifacts';
import {
  buildDispatchArtifactMap,
  buildHistoricalDispatchArtifactMap,
  resolveDispatchArtifacts,
} from '../dispatch-artifacts';

function entry(
  type: ArtifactEntryView['type'],
  name: string,
  version: number,
  producedBy: string,
  createdAt: string,
): ArtifactEntryView {
  return {
    ref: { type, name, version, checksum: `sha-${type}-v${String(version)}` },
    type,
    name,
    version,
    producedBy,
    createdAt,
    sizeBytes: 100,
  };
}

function taskPrompt(
  roleId: string,
  dispatchId: string,
  stateId: string,
  timestamp: string,
  requiredOutput: string,
): DashboardAgentStreamEvent {
  return {
    runId: 'run-1',
    roleId,
    dispatchId,
    stateId,
    timestamp,
    type: 'status',
    content: 'task',
    structuredData: {
      messageType: 'task_prompt',
      requiredOutput,
    },
  };
}

describe('buildHistoricalDispatchArtifactMap', () => {
  it('binds outputs to the dispatch time window and includes intake for INTAKE', () => {
    const lines = [
      taskPrompt(
        'requirements_analyst',
        'dispatch-1',
        'INTAKE',
        '2026-07-15T22:58:20.995Z',
        'canonical_specification',
      ),
      taskPrompt(
        'requirements_analyst',
        'dispatch-2',
        'REFINEMENT',
        '2026-07-15T22:59:48.730Z',
        'canonical_specification',
      ),
      taskPrompt('planner', 'dispatch-1', 'PLANNING', '2026-07-15T23:02:04.322Z', 'plan'),
    ];

    const inventory = [
      entry('intake_requirements', 'intake-requirements', 1, 'human', '2026-07-15T22:58:19.000Z'),
      entry(
        'canonical_specification',
        'requirements_analyst-output',
        1,
        'requirements_analyst',
        '2026-07-15T22:59:48.670Z',
      ),
      entry(
        'canonical_specification',
        'requirements_analyst-output',
        2,
        'requirements_analyst',
        '2026-07-15T23:01:58.717Z',
      ),
      entry('plan', 'planner-output', 1, 'planner', '2026-07-15T23:03:31.257Z'),
    ];

    const map = buildHistoricalDispatchArtifactMap(lines, inventory);

    const intake = resolveDispatchArtifacts('requirements_analyst', 'dispatch-1', new Map(), map);
    expect(intake?.inputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual([
      'intake_requirements@v1',
    ]);
    expect(intake?.outputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual([
      'canonical_specification@v1',
    ]);

    const requirements = resolveDispatchArtifacts(
      'requirements_analyst',
      'dispatch-2',
      new Map(),
      map,
    );
    expect(requirements?.outputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual([
      'canonical_specification@v2',
    ]);
    expect(requirements?.inputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual([
      'canonical_specification@v1',
    ]);

    const planning = resolveDispatchArtifacts('planner', 'dispatch-1', new Map(), map);
    expect(planning?.inputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual([
      'canonical_specification@v2',
    ]);
    expect(planning?.outputs.map((r) => `${r.type}@v${String(r.version)}`)).toEqual(['plan@v1']);
  });

  it('returns empty map when no anchors exist', () => {
    const lines: DashboardAgentStreamEvent[] = [];
    const inventory = [entry('plan', 'planner-output', 1, 'planner', '2026-07-15T23:03:31.257Z')];
    const map = buildHistoricalDispatchArtifactMap(lines, inventory);
    expect(map.size).toBe(0);
  });

  it('returns empty map when inventory is empty', () => {
    const lines = [
      taskPrompt(
        'requirements_analyst',
        'dispatch-1',
        'INTAKE',
        '2026-07-15T22:58:20.995Z',
        'canonical_specification',
      ),
    ];
    const map = buildHistoricalDispatchArtifactMap(lines, []);
    expect(map.size).toBe(0);
  });

  it('prefers stream refs over historical when present', () => {
    const historical = new Map<string, DispatchArtifacts>([
      [
        'requirements_analyst\0dispatch-1',
        {
          inputs: [
            {
              type: 'intake_requirements',
              name: 'intake-requirements',
              version: 1,
              checksum: 'a',
            },
          ],
          outputs: [
            {
              type: 'canonical_specification',
              name: 'out',
              version: 1,
              checksum: 'b',
            },
          ],
        },
      ],
    ]);
    const stream = new Map<string, DispatchArtifacts>([
      [
        'requirements_analyst\0dispatch-1',
        {
          inputs: [
            {
              type: 'intake_requirements',
              name: 'intake-requirements',
              version: 1,
              checksum: 'stream',
            },
          ],
          outputs: [
            {
              type: 'canonical_specification',
              name: 'out',
              version: 9,
              checksum: 'stream-out',
            },
          ],
        },
      ],
    ]);

    const resolved = resolveDispatchArtifacts(
      'requirements_analyst',
      'dispatch-1',
      stream,
      historical,
    );
    expect(resolved?.outputs[0]?.version).toBe(9);
    expect(resolved?.inputs[0]?.checksum).toBe('stream');
  });
});

describe('buildDispatchArtifactMap', () => {
  it('collects inputs from task_prompt events', () => {
    const lines: DashboardAgentStreamEvent[] = [
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'status',
        content: 'task',
        structuredData: {
          messageType: 'task_prompt',
          inputArtifacts: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 'c' }],
        },
      },
    ];

    const map = buildDispatchArtifactMap(lines);
    const entry = map.get('analyst\0d1');
    expect(entry).toBeDefined();
    expect(entry?.inputs).toHaveLength(1);
    expect(entry?.inputs[0]?.type).toBe('intake_requirements');
    expect(entry?.outputs).toHaveLength(0);
  });

  it('collects outputs from artifact_produced events', () => {
    const lines: DashboardAgentStreamEvent[] = [
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:01Z',
        type: 'status',
        content: 'artifact produced',
        structuredData: {
          phase: 'artifact_produced',
          outputArtifacts: [
            { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'x' },
          ],
        },
      },
    ];

    const map = buildDispatchArtifactMap(lines);
    const entry = map.get('analyst\0d1');
    expect(entry).toBeDefined();
    expect(entry?.outputs).toHaveLength(1);
    expect(entry?.outputs[0]?.type).toBe('canonical_specification');
    expect(entry?.inputs).toHaveLength(0);
  });

  it('collects both inputs and outputs for the same dispatch', () => {
    const lines: DashboardAgentStreamEvent[] = [
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'status',
        content: 'task',
        structuredData: {
          messageType: 'task_prompt',
          inputArtifacts: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 'c' }],
        },
      },
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:01Z',
        type: 'status',
        content: 'produced',
        structuredData: {
          phase: 'artifact_produced',
          outputArtifacts: [
            { type: 'canonical_specification', name: 'spec', version: 1, checksum: 'x' },
          ],
        },
      },
    ];

    const map = buildDispatchArtifactMap(lines);
    const entry = map.get('analyst\0d1');
    expect(entry?.inputs).toHaveLength(1);
    expect(entry?.outputs).toHaveLength(1);
  });

  it('returns empty map for lines with no relevant events', () => {
    const lines: DashboardAgentStreamEvent[] = [
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'status',
        content: 'just logging',
        structuredData: { phase: 'running' },
      },
    ];

    const map = buildDispatchArtifactMap(lines);
    expect(map.size).toBe(0);
  });

  it('uses protocolMessage when available', () => {
    const lines: DashboardAgentStreamEvent[] = [
      {
        runId: 'run-1',
        roleId: 'analyst',
        dispatchId: 'd1',
        stateId: 'INTAKE',
        timestamp: '2026-01-01T00:00:00Z',
        type: 'status',
        content: 'task',
        protocolMessage: {
          messageType: 'task_prompt',
          payload: {
            inputArtifacts: [
              { type: 'intake_requirements', name: 'req', version: 2, checksum: 'proto' },
            ],
          },
        },
      },
    ];

    const map = buildDispatchArtifactMap(lines);
    const entry = map.get('analyst\0d1');
    expect(entry?.inputs).toHaveLength(1);
    expect(entry?.inputs[0]?.version).toBe(2);
  });
});

describe('resolveDispatchArtifacts edge cases', () => {
  it('returns undefined when neither map has data', () => {
    const result = resolveDispatchArtifacts('role', 'dispatch', new Map(), new Map());
    expect(result).toBeUndefined();
  });

  it('returns historical data when stream map is empty', () => {
    const historical = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 'h' }],
          outputs: [{ type: 'canonical_specification', name: 'spec', version: 1, checksum: 'h' }],
        },
      ],
    ]);

    const result = resolveDispatchArtifacts('analyst', 'd1', new Map(), historical);
    expect(result?.inputs).toHaveLength(1);
    expect(result?.inputs[0]?.checksum).toBe('h');
    expect(result?.outputs).toHaveLength(1);
  });

  it('returns stream data when historical map is empty', () => {
    const stream = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 's' }],
          outputs: [],
        },
      ],
    ]);

    const result = resolveDispatchArtifacts('analyst', 'd1', stream, new Map());
    expect(result?.inputs).toHaveLength(1);
    expect(result?.inputs[0]?.checksum).toBe('s');
    expect(result?.outputs).toHaveLength(0);
  });

  it('fills missing inputs from historical when stream has only outputs', () => {
    const stream = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [],
          outputs: [{ type: 'canonical_specification', name: 'spec', version: 3, checksum: 's' }],
        },
      ],
    ]);

    const historical = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 'h' }],
          outputs: [{ type: 'canonical_specification', name: 'spec', version: 1, checksum: 'h' }],
        },
      ],
    ]);

    const result = resolveDispatchArtifacts('analyst', 'd1', stream, historical);
    expect(result?.inputs[0]?.checksum).toBe('h');
    expect(result?.outputs[0]?.version).toBe(3);
  });

  it('fills missing outputs from historical when stream has only inputs', () => {
    const stream = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [{ type: 'intake_requirements', name: 'req', version: 1, checksum: 's' }],
          outputs: [],
        },
      ],
    ]);

    const historical = new Map<string, DispatchArtifacts>([
      [
        'analyst\0d1',
        {
          inputs: [],
          outputs: [{ type: 'canonical_specification', name: 'spec', version: 2, checksum: 'h' }],
        },
      ],
    ]);

    const result = resolveDispatchArtifacts('analyst', 'd1', stream, historical);
    expect(result?.inputs[0]?.checksum).toBe('s');
    expect(result?.outputs[0]?.checksum).toBe('h');
  });

  it('returns undefined for unknown dispatch key in both maps', () => {
    const stream = new Map<string, DispatchArtifacts>([
      [
        'other\0d9',
        {
          inputs: [{ type: 'plan', name: 'p', version: 1, checksum: 'x' }],
          outputs: [],
        },
      ],
    ]);

    const result = resolveDispatchArtifacts('analyst', 'd1', stream, new Map());
    expect(result).toBeUndefined();
  });
});
