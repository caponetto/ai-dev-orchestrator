import type { ArtifactEntryView, ArtifactRef } from '@ai-orchestrator/schemas';

import type { DashboardAgentStreamEvent } from '../hooks/use-agent-stream';

export interface DispatchArtifacts {
  readonly inputs: readonly ArtifactRef[];
  readonly outputs: readonly ArtifactRef[];
}

interface TaskPromptAnchor {
  readonly roleId: string;
  readonly dispatchId: string;
  readonly stateId: string;
  readonly timestamp: string;
  readonly requiredOutput: string | undefined;
  readonly streamInputs: readonly ArtifactRef[];
}

function dispatchArtifactKey(roleId: string, dispatchId: string): string {
  return `${roleId}\0${dispatchId}`;
}

function parseArtifactRef(raw: unknown): ArtifactRef | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj['type'] !== 'string' ||
    typeof obj['name'] !== 'string' ||
    typeof obj['version'] !== 'number'
  ) {
    return null;
  }
  return {
    type: obj['type'] as ArtifactRef['type'],
    name: obj['name'],
    version: obj['version'],
    checksum: typeof obj['checksum'] === 'string' ? obj['checksum'] : '',
  };
}

function parseArtifactRefList(raw: unknown): ArtifactRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseArtifactRef).filter((ref): ref is ArtifactRef => ref !== null);
}

function entryToRef(entry: ArtifactEntryView): ArtifactRef {
  return entry.ref;
}

function collectTaskPromptAnchors(
  allLines: readonly DashboardAgentStreamEvent[],
): TaskPromptAnchor[] {
  const anchors: TaskPromptAnchor[] = [];

  for (const line of allLines) {
    const sd = line.structuredData ?? {};
    const messageType =
      line.protocolMessage?.messageType ??
      (typeof sd['messageType'] === 'string' ? sd['messageType'] : undefined);
    if (messageType !== 'task_prompt') {
      continue;
    }

    const payload = line.protocolMessage?.payload ?? sd;
    let requiredOutput: string | undefined;
    if (typeof payload['requiredOutput'] === 'string') {
      requiredOutput = payload['requiredOutput'];
    } else if (typeof sd['requiredOutput'] === 'string') {
      requiredOutput = sd['requiredOutput'];
    }

    anchors.push({
      roleId: line.roleId,
      dispatchId: line.dispatchId,
      stateId: line.stateId,
      timestamp: line.timestamp,
      requiredOutput,
      streamInputs: parseArtifactRefList(payload['inputArtifacts'] ?? sd['inputArtifacts']),
    });
  }

  anchors.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return anchors;
}

/** Stream-emitted input/output refs keyed by role+dispatch. */
export function buildDispatchArtifactMap(
  allLines: readonly DashboardAgentStreamEvent[],
): Map<string, DispatchArtifacts> {
  const map = new Map<string, { inputs: ArtifactRef[]; outputs: ArtifactRef[] }>();

  const ensure = (key: string): { inputs: ArtifactRef[]; outputs: ArtifactRef[] } => {
    const existing = map.get(key);
    if (existing) {
      return existing;
    }
    const created = { inputs: [] as ArtifactRef[], outputs: [] as ArtifactRef[] };
    map.set(key, created);
    return created;
  };

  for (const line of allLines) {
    const key = dispatchArtifactKey(line.roleId, line.dispatchId);
    const sd = line.structuredData ?? {};
    const messageType =
      line.protocolMessage?.messageType ??
      (typeof sd['messageType'] === 'string' ? sd['messageType'] : undefined);

    if (messageType === 'task_prompt') {
      const payload = line.protocolMessage?.payload ?? sd;
      const inputs = parseArtifactRefList(payload['inputArtifacts'] ?? sd['inputArtifacts']);
      if (inputs.length > 0) {
        ensure(key).inputs = inputs;
      }
    }

    if (sd['phase'] === 'artifact_produced' || messageType === 'artifact_produced') {
      const outputs = parseArtifactRefList(sd['outputArtifacts']);
      if (outputs.length > 0) {
        ensure(key).outputs = outputs;
      }
    }
  }

  return map;
}

/**
 * Reconstruct dispatch-accurate artifacts for runs that predate stream refs.
 * Outputs are time-bounded between this role's task_prompt and the next one.
 * Inputs use intake (for INTAKE) plus latest prior requiredOutput types.
 */
export function buildHistoricalDispatchArtifactMap(
  allLines: readonly DashboardAgentStreamEvent[],
  inventory: readonly ArtifactEntryView[],
): Map<string, DispatchArtifacts> {
  const map = new Map<string, DispatchArtifacts>();
  const anchors = collectTaskPromptAnchors(allLines);
  if (anchors.length === 0 || inventory.length === 0) {
    return map;
  }

  const nextTimestampByKey = new Map<string, string>();
  const lastByRole = new Map<string, string>();
  for (const anchor of anchors) {
    const key = dispatchArtifactKey(anchor.roleId, anchor.dispatchId);
    const prevKey = lastByRole.get(anchor.roleId);
    if (prevKey) {
      nextTimestampByKey.set(prevKey, anchor.timestamp);
    }
    lastByRole.set(anchor.roleId, key);
  }

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const key = dispatchArtifactKey(anchor.roleId, anchor.dispatchId);
    const windowEnd = nextTimestampByKey.get(key);

    const outputs = inventory
      .filter((entry) => {
        if (entry.producedBy !== anchor.roleId) {
          return false;
        }
        if (anchor.requiredOutput && entry.type !== anchor.requiredOutput) {
          return false;
        }
        if (entry.createdAt <= anchor.timestamp) {
          return false;
        }
        if (windowEnd && entry.createdAt > windowEnd) {
          return false;
        }
        return true;
      })
      .map(entryToRef);

    const priorRequiredTypes = new Set<string>();
    for (let j = 0; j < i; j++) {
      const priorRequiredOutput = anchors[j].requiredOutput;
      if (priorRequiredOutput) {
        priorRequiredTypes.add(priorRequiredOutput);
      }
    }

    const inputsByType = new Map<string, ArtifactEntryView>();
    for (const entry of inventory) {
      if (entry.createdAt > anchor.timestamp) {
        continue;
      }
      if (!priorRequiredTypes.has(entry.type)) {
        continue;
      }
      const existing = inputsByType.get(entry.type);
      if (!existing || entry.version > existing.version) {
        inputsByType.set(entry.type, entry);
      }
    }

    if (anchor.stateId === 'INTAKE') {
      for (const entry of inventory) {
        if (entry.type !== 'intake_requirements') {
          continue;
        }
        const existing = inputsByType.get(entry.type);
        if (!existing || entry.version > existing.version) {
          inputsByType.set(entry.type, entry);
        }
      }
    }

    const inputs = [...inputsByType.values()].map(entryToRef);
    if (inputs.length > 0 || outputs.length > 0) {
      map.set(key, { inputs, outputs });
    }
  }

  return map;
}

/** Prefer stream refs; fill missing sides from historical reconstruction. */
export function resolveDispatchArtifacts(
  roleId: string,
  dispatchId: string,
  streamMap: ReadonlyMap<string, DispatchArtifacts>,
  historicalMap: ReadonlyMap<string, DispatchArtifacts>,
): DispatchArtifacts | undefined {
  const key = dispatchArtifactKey(roleId, dispatchId);
  const fromStream = streamMap.get(key);
  const fromHistorical = historicalMap.get(key);

  const inputs =
    fromStream && fromStream.inputs.length > 0 ? fromStream.inputs : (fromHistorical?.inputs ?? []);
  const outputs =
    fromStream && fromStream.outputs.length > 0
      ? fromStream.outputs
      : (fromHistorical?.outputs ?? []);

  if (inputs.length === 0 && outputs.length === 0) {
    return undefined;
  }
  return { inputs, outputs };
}
