import { hashContent } from '../shared/hash';

/** Compute a SHA-256 checksum of the given content. Returns `sha256:<hex>`. */
export function computeChecksum(content: string): string {
  return hashContent(content);
}

/** Verify that content matches the expected checksum. */
export function verifyChecksum(content: string, expected: string): boolean {
  return computeChecksum(content) === expected;
}
