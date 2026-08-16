import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeChecksum, verifyChecksum } from '../checksum-engine';

describe('checksum engine', () => {
  it('computes SHA-256 with sha256: prefix', () => {
    const content = 'hello world';
    const expected = createHash('sha256').update(content, 'utf8').digest('hex');
    expect(computeChecksum(content)).toBe(`sha256:${expected}`);
  });

  it('produces deterministic output for the same input', () => {
    const content = 'deterministic test content';
    expect(computeChecksum(content)).toBe(computeChecksum(content));
  });

  it('produces different checksums for different content', () => {
    expect(computeChecksum('content A')).not.toBe(computeChecksum('content B'));
  });

  it('handles empty content', () => {
    const emptyHash = createHash('sha256').update('', 'utf8').digest('hex');
    expect(computeChecksum('')).toBe(`sha256:${emptyHash}`);
  });

  it('handles large content', () => {
    const large = 'x'.repeat(100_000);
    const result = computeChecksum(large);
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('handles unicode content', () => {
    const result = computeChecksum('日本語テスト 🎉');
    expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('verifyChecksum returns true for matching content', () => {
    const content = 'verify me';
    const checksum = computeChecksum(content);
    expect(verifyChecksum(content, checksum)).toBe(true);
  });

  it('verifyChecksum returns false for mismatched content', () => {
    const checksum = computeChecksum('original');
    expect(verifyChecksum('tampered', checksum)).toBe(false);
  });

  it('verifyChecksum returns false for invalid checksum format', () => {
    expect(verifyChecksum('content', 'not-a-valid-checksum')).toBe(false);
  });
});
