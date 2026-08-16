import type { AdaptiveConfig } from '@ai-orchestrator/schemas';

export const NO_RECOMMENDATION: AdaptiveConfig = {
  recommendedMaxOutputTokens: null,
  recommendedMaxRetries: null,
  recommendedTimeoutMs: null,
  modelEscalation: { recommended: false, reason: null },
  basis: { sampleSize: 0, profileAge: '' },
};
