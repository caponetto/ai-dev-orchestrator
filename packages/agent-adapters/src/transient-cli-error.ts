/** Recognize service failures that may succeed on a fresh CLI invocation. */
export function isTransientCliError(message: string): boolean {
  return /unexpected server error|internal server error|\b(?:429|500|502|503|504|529)\b|rate[_ -]?limit(?:ed|_error)?|too many requests|temporarily overloaded|overloaded_error|service unavailable|server overloaded|connection (?:reset|closed)|ECONNRESET|ETIMEDOUT/i.test(
    message,
  );
}
