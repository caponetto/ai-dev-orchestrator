/** Port for estimating token counts and truncating text to fit token budgets. */
export interface TokenEstimator {
  /** Estimate the token count for a text string. */
  estimate(text: string, model?: string): number;

  /** Truncate text to fit within a token limit. */
  truncateToFit(text: string, maxTokens: number, model?: string): string;
}
