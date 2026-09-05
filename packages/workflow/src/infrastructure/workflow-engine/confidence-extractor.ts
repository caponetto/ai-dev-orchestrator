import type { ActionResult, ConfidenceReport } from '@ai-dev-orchestrator/schemas';

export function extractConfidenceReport(results: readonly ActionResult[]): ConfidenceReport | null {
  for (const result of results) {
    if (result.action.type === 'dispatch_worker' && result.confidenceReport) {
      return result.confidenceReport;
    }
  }
  return null;
}
