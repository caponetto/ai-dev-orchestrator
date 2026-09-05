/** Renders a RunManifest as a Markdown report string. */
import type { RunManifest } from '@ai-dev-orchestrator/schemas';
import { formatBytes, formatDuration } from '@ai-dev-orchestrator/utils';
export function renderReport(manifest: RunManifest): string {
  const lines: string[] = [];

  lines.push(`# Run Report: ${manifest.runId}`);
  lines.push('');
  lines.push(`**Workflow:** ${manifest.workflow.name} v${manifest.workflow.version}`);
  lines.push(`**Status:** ${manifest.status}`);
  lines.push(`**Final State:** ${manifest.finalState}`);
  if (manifest.abortReason) {
    lines.push(`**Abort Reason:** ${manifest.abortReason}`);
  }
  lines.push('');

  lines.push('## Timing');
  lines.push('');
  lines.push(`- **Started:** ${manifest.timing.startedAt}`);
  lines.push(`- **Completed:** ${manifest.timing.completedAt}`);
  lines.push(`- **Duration:** ${formatDuration(manifest.timing.totalDurationMs)}`);
  lines.push('');

  if (manifest.timing.stateTimings.length > 0) {
    lines.push('| State | Duration | Visits |');
    lines.push('|-------|----------|--------|');
    for (const st of manifest.timing.stateTimings) {
      lines.push(`| ${st.stateId} | ${formatDuration(st.durationMs)} | ${String(st.visits)} |`);
    }
    lines.push('');
  }

  const trace = manifest.timing.stateTrace;
  if (trace && trace.length > 0) {
    lines.push('## Workflow Trace');
    lines.push('');
    lines.push('| # | State | Entered At | Exited At | Duration |');
    lines.push('|---|-------|------------|-----------|----------|');
    let idx = 1;
    for (const sv of trace) {
      lines.push(
        `| ${String(idx)} | ${sv.stateId} | ${sv.enteredAt} | ${sv.exitedAt} | ${formatDuration(sv.durationMs)} |`,
      );
      idx += 1;
    }
    lines.push('');
  } else if (manifest.timing.stateTimings.length > 0) {
    lines.push('## Workflow Trace');
    lines.push('');
    lines.push('| # | State | Entered At | Duration | Visits |');
    lines.push('|---|-------|------------|----------|--------|');
    let idx = 1;
    for (const st of manifest.timing.stateTimings) {
      lines.push(
        `| ${String(idx)} | ${st.stateId} | ${st.enteredAt} | ${formatDuration(st.durationMs)} | ${String(st.visits)} |`,
      );
      idx += 1;
    }
    lines.push('');
  }

  lines.push('## Token Usage');
  lines.push('');
  lines.push(`- **Input Tokens:** ${formatNumber(manifest.tokenUsage.totalInputTokens)}`);
  lines.push(`- **Output Tokens:** ${formatNumber(manifest.tokenUsage.totalOutputTokens)}`);
  lines.push(`- **Total Tokens:** ${formatNumber(manifest.tokenUsage.totalTokens)}`);
  lines.push('');

  if (manifest.activeRoles.length > 0) {
    lines.push('## Roles');
    lines.push('');
    lines.push('| Role | Dispatches | Input Tokens | Output Tokens | Duration |');
    lines.push('|------|------------|--------------|---------------|----------|');
    for (const r of manifest.activeRoles) {
      lines.push(
        `| ${r.role} | ${String(r.dispatches)} | ${formatNumber(r.inputTokens)} | ${formatNumber(r.outputTokens)} | ${formatDuration(r.totalDurationMs)} |`,
      );
    }
    lines.push('');
  }

  if (manifest.iterations.length > 0) {
    lines.push('## Iterations');
    lines.push('');
    lines.push('| Contract | Iterations | Judge Arbitrations | Status | Findings |');
    lines.push('|----------|------------|--------------------|--------|----------|');
    for (const it of manifest.iterations) {
      lines.push(
        `| ${it.contractId} | ${String(it.totalIterations)} | ${String(it.judgeArbitrations)} | ${it.finalStatus} | ${String(it.findingsResolved)}/${String(it.findingsTotal)} resolved |`,
      );
    }
    lines.push('');

    const totalFindings = manifest.iterations.reduce((s, it) => s + it.findingsTotal, 0);
    if (totalFindings > 0) {
      const resolvedFindings = manifest.iterations.reduce((s, it) => s + it.findingsResolved, 0);
      lines.push('## Findings');
      lines.push('');
      lines.push(`- **Total Findings:** ${String(totalFindings)}`);
      lines.push(`- **Resolved:** ${String(resolvedFindings)}`);
      lines.push(`- **Unresolved:** ${String(totalFindings - resolvedFindings)}`);
      lines.push('');
      lines.push('| Contract | Total | Resolved |');
      lines.push('|----------|-------|----------|');
      for (const it of manifest.iterations) {
        if (it.findingsTotal > 0) {
          lines.push(
            `| ${it.contractId} | ${String(it.findingsTotal)} | ${String(it.findingsResolved)} |`,
          );
        }
      }
      lines.push('');
    }
  }

  if (manifest.artifactInventory.length > 0) {
    lines.push('## Artifacts');
    lines.push('');
    lines.push('| Type | Name | Produced By | Size | Created At |');
    lines.push('|------|------|-------------|------|------------|');
    for (const a of manifest.artifactInventory) {
      lines.push(
        `| ${a.ref.type} | ${a.ref.name} | ${a.producedBy} | ${formatBytes(a.sizeBytes)} | ${a.createdAt} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Artifacts:** ${String(manifest.totalArtifacts)}`);
  lines.push(`- **Governance Decisions:** ${String(manifest.governanceDecisions)}`);
  lines.push(`- **Escalations:** ${String(manifest.escalations)}`);
  lines.push(`- **Human Interventions:** ${String(manifest.humanInterventions)}`);
  lines.push('');

  return lines.join('\n');
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
