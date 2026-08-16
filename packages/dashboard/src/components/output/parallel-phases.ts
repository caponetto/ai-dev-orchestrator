import type { DashboardAgentStreamEvent } from '../../hooks/use-agent-stream';

import { classifySender, str } from './output-utils';

export interface ParallelPhaseDispatch {
  readonly roleId: string;
  readonly dispatchId: string;
  readonly lines: DashboardAgentStreamEvent[];
  readonly status: 'working' | 'done' | 'error';
  readonly summary?: string;
}

export interface ParallelPhase {
  readonly stateId: string;
  readonly dispatches: ReadonlyMap<string, ParallelPhaseDispatch>;
}

export interface MutableDispatch {
  roleId: string;
  dispatchId: string;
  lines: DashboardAgentStreamEvent[];
  status: 'working' | 'done' | 'error';
  summary?: string;
  startedAt?: string;
}

export function buildStateDispatchMap(
  lines: readonly DashboardAgentStreamEvent[],
): Map<string, Map<string, MutableDispatch>> {
  const byState = new Map<string, Map<string, MutableDispatch>>();

  for (const line of lines) {
    const sender = classifySender(line);
    if (sender === 'orchestrator' || sender === 'human') {
      continue;
    }

    const { stateId, dispatchId, roleId } = line;
    if (!stateId || !dispatchId) {
      continue;
    }

    let stateDispatches = byState.get(stateId);
    if (!stateDispatches) {
      stateDispatches = new Map();
      byState.set(stateId, stateDispatches);
    }

    let dispatch = stateDispatches.get(dispatchId);
    if (!dispatch) {
      dispatch = { roleId, dispatchId, lines: [], status: 'working' };
      stateDispatches.set(dispatchId, dispatch);
    }

    dispatch.lines.push(line);

    const mt = line.protocolMessage?.messageType;
    const smt = line.structuredData?.['messageType'] as string | undefined;
    const phase = line.structuredData?.['phase'] as string | undefined;
    if (mt === 'done' || phase === 'done' || smt === 'script_completed') {
      dispatch.status = 'done';
      dispatch.summary = str(line.protocolMessage?.payload.summary);
    } else if (mt === 'error') {
      dispatch.status = 'error';
      dispatch.summary = str(line.protocolMessage?.payload.message);
    }
  }

  return byState;
}

export function resolveTerminalStatuses(
  byState: Map<string, Map<string, MutableDispatch>>,
  allLines: readonly DashboardAgentStreamEvent[],
): void {
  const knownDispatchIds = new Set<string>();
  for (const stateDispatches of byState.values()) {
    for (const d of stateDispatches.values()) {
      if (d.status === 'working') {
        knownDispatchIds.add(d.dispatchId);
      }
    }
  }

  if (knownDispatchIds.size > 0) {
    for (const line of allLines) {
      if (!knownDispatchIds.has(line.dispatchId)) {
        continue;
      }
      const mt =
        line.protocolMessage?.messageType ??
        (line.structuredData?.['messageType'] as string | undefined);
      const ph = line.structuredData?.['phase'] as string | undefined;
      if (mt === 'done' || mt === 'script_completed' || mt === 'error' || ph === 'done') {
        for (const stateDispatches of byState.values()) {
          const dispatch = stateDispatches.get(line.dispatchId);
          if (dispatch?.status === 'working') {
            dispatch.status = mt === 'error' ? 'error' : 'done';
            dispatch.summary = str(
              line.protocolMessage?.payload.summary ??
                line.protocolMessage?.payload.message ??
                line.structuredData?.['summary'] ??
                line.structuredData?.['message'],
            );
            knownDispatchIds.delete(line.dispatchId);
          }
        }
      }
    }
  }
}

export function markInactiveAsDone(
  byState: Map<string, Map<string, MutableDispatch>>,
  isRunActive: boolean,
): void {
  if (!isRunActive) {
    for (const stateDispatches of byState.values()) {
      for (const d of stateDispatches.values()) {
        if (d.status === 'working') {
          d.status = 'done';
        }
      }
    }
  }
}

export function populateDispatchStartTimes(
  byState: Map<string, Map<string, MutableDispatch>>,
  allLines: readonly DashboardAgentStreamEvent[],
): void {
  const earliest = new Map<string, string>();
  for (const line of allLines) {
    if (!line.dispatchId || !line.timestamp) {
      continue;
    }
    const prev = earliest.get(line.dispatchId);
    if (!prev || line.timestamp < prev) {
      earliest.set(line.dispatchId, line.timestamp);
    }
  }

  for (const stateDispatches of byState.values()) {
    for (const d of stateDispatches.values()) {
      const ts = earliest.get(d.dispatchId);
      if (ts) {
        d.startedAt = ts;
      }
    }
  }
}

function dispatchSortKey(d: MutableDispatch): string {
  if (d.startedAt) {
    return d.startedAt;
  }
  return d.lines.length > 0 ? d.lines[0].timestamp : '';
}

export function groupDispatchesIntoParallelRounds(
  byState: Map<string, Map<string, MutableDispatch>>,
): Map<string, ParallelPhase> {
  const phases = new Map<string, ParallelPhase>();
  for (const [stateId, dispatches] of byState) {
    const sorted = [...dispatches.values()].sort((a, b) => {
      const aStart = dispatchSortKey(a);
      const bStart = dispatchSortKey(b);
      return aStart.localeCompare(bStart);
    });

    const rounds: MutableDispatch[][] = [];
    for (const d of sorted) {
      const dStart = dispatchSortKey(d);
      let placed = false;
      if (rounds.length > 0) {
        const lastRound = rounds.at(-1);
        const allDone = lastRound?.every((r) => r.status === 'done' || r.status === 'error');
        if (allDone) {
          const lastEnd = lastRound?.reduce((max, r) => {
            const t = r.lines.at(-1)?.timestamp ?? '';
            return t > max ? t : max;
          }, '');
          if (lastEnd && dStart > lastEnd) {
            rounds.push([d]);
            placed = true;
          }
        }
      }
      if (!placed) {
        if (rounds.length === 0) {
          rounds.push([]);
        }
        rounds.at(-1)?.push(d);
      }
    }

    for (let ri = 0; ri < rounds.length; ri++) {
      const round = rounds[ri];
      const roundDispatches = new Map<string, MutableDispatch>();
      for (const d of round) {
        roundDispatches.set(d.dispatchId, d);
      }
      if (round.length >= 2) {
        const phaseKey = ri === 0 ? stateId : `${stateId}:${String(ri)}`;
        phases.set(phaseKey, { stateId, dispatches: roundDispatches });
      }
    }
  }

  return phases;
}

export function detectParallelPhases(
  lines: readonly DashboardAgentStreamEvent[],
  allLines: readonly DashboardAgentStreamEvent[],
  isRunActive: boolean,
): Map<string, ParallelPhase> {
  const byState = buildStateDispatchMap(lines);
  resolveTerminalStatuses(byState, allLines);
  markInactiveAsDone(byState, isRunActive);
  populateDispatchStartTimes(byState, allLines);
  return groupDispatchesIntoParallelRounds(byState);
}
