import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashSessionToken } from './tokens.js';

describe('hashSessionToken', () => {
  it('is the SHA-256 of the token as lowercase hex, the format the token_hash checks accept', () => {
    const token = 'ovs_synthetic-session-token-0000000000000000000000';

    expect(hashSessionToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken('ovu_a')).not.toBe(hashSessionToken('ovu_b'));
  });
});
