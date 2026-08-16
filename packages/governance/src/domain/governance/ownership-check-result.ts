/** Result of an ownership enforcement check. */
export interface OwnershipCheckResult {
  readonly allowed: boolean;
  readonly reason: string;
}
