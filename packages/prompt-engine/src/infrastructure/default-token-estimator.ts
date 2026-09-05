import type { TokenEstimator } from '@ai-dev-orchestrator/ports';

const CHARS_PER_TOKEN = 4;

/** Character-ratio-based token estimator for prompt budget calculations. */
export class DefaultTokenEstimator implements TokenEstimator {
  private readonly charsPerToken: number;

  constructor(charsPerToken = CHARS_PER_TOKEN) {
    this.charsPerToken = charsPerToken;
  }

  estimate(text: string, _model?: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  truncateToFit(text: string, maxTokens: number, _model?: string): string {
    const maxChars = maxTokens * this.charsPerToken;
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars);
  }
}
