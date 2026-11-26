import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PEPPER_ID_LABEL,
  API_KEY_PREFIXES,
  API_KEY_PREVIOUS_PEPPERS_MAX,
  apiKeyHashCandidates,
  apiKeyPepperId,
  generateApiKey,
  hashApiKeySecret,
} from './api-keys.js';

// Synthetic server pepper generated per run.
const pepper = randomBytes(32);

describe('API key prefixes', () => {
  it('maps each environment kind to a distinct, recognisable prefix', () => {
    expect(API_KEY_PREFIXES).toEqual({ sandbox: 'ov_sbx_', production: 'ov_prod_' });
  });
});

describe('generateApiKey', () => {
  it.each([
    ['sandbox', 'ov_sbx_'],
    ['production', 'ov_prod_'],
  ] as const)('issues a %s key with a 256-bit random secret', (kind, prefix) => {
    const key = generateApiKey(kind, pepper);

    expect(key.prefix).toBe(prefix);
    expect(key.token.startsWith(prefix)).toBe(true);
    expect(key.token.slice(prefix.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.secretHash).toBe(hashApiKeySecret(key.token, pepper));
  });

  it('never repeats a token', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateApiKey('sandbox', pepper).token),
    );

    expect(tokens.size).toBe(100);
  });
});

describe('hashApiKeySecret', () => {
  it('is HMAC-SHA256 of the full token keyed by the pepper, as lowercase hex', () => {
    const token = 'ov_sbx_synthetic-token-for-tests';
    const expected = createHmac('sha256', pepper).update(token, 'utf8').digest('hex');

    expect(hashApiKeySecret(token, pepper)).toBe(expected);
    expect(hashApiKeySecret(token, pepper)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, so keys can be found by an indexed equality lookup', () => {
    const { token } = generateApiKey('production', pepper);

    expect(hashApiKeySecret(token, pepper)).toBe(hashApiKeySecret(token, Buffer.from(pepper)));
  });

  it('depends on the pepper', () => {
    const { token } = generateApiKey('sandbox', pepper);

    expect(hashApiKeySecret(token, randomBytes(32))).not.toBe(hashApiKeySecret(token, pepper));
  });

  it.each([0, 16, 31])('rejects a %i-byte pepper', (length) => {
    expect(() => hashApiKeySecret('ov_sbx_x', randomBytes(length))).toThrow(/at least 32 bytes/);
    expect(() => generateApiKey('sandbox', randomBytes(length))).toThrow(/at least 32 bytes/);
  });
});

describe('apiKeyPepperId (C247.1, Workflow 11B; amendment 9)', () => {
  it('is the first 16 hex characters of an HMAC of its label under the pepper', () => {
    const expected = createHmac('sha256', pepper)
      .update('openverify/api-key-pepper-id/v1', 'utf8')
      .digest('hex')
      .slice(0, 16);

    expect(API_KEY_PEPPER_ID_LABEL).toBe('openverify/api-key-pepper-id/v1');
    expect(apiKeyPepperId(pepper)).toBe(expected);
    expect(apiKeyPepperId(pepper)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('names each pepper apart and never equals a hash made under it', () => {
    const other = randomBytes(32);
    const { token, secretHash } = generateApiKey('sandbox', pepper);

    expect(apiKeyPepperId(other)).not.toBe(apiKeyPepperId(pepper));
    expect(secretHash.startsWith(apiKeyPepperId(pepper))).toBe(false);
    expect(hashApiKeySecret(token, pepper)).toBe(secretHash);
  });

  it.each([0, 31])('rejects a %i-byte pepper', (length) => {
    expect(() => apiKeyPepperId(randomBytes(length))).toThrow(/at least 32 bytes/);
  });
});

describe('apiKeyHashCandidates (C247.1)', () => {
  const token = 'ov_sbx_synthetic-token-for-pepper-rotation';
  const first = randomBytes(32);
  const second = randomBytes(40);

  it('answers the current pepper first, then each earlier one in the order given', () => {
    expect(apiKeyHashCandidates(token, pepper, [first, second])).toEqual([
      {
        secretHash: hashApiKeySecret(token, pepper),
        pepperKeyId: apiKeyPepperId(pepper),
        current: true,
      },
      {
        secretHash: hashApiKeySecret(token, first),
        pepperKeyId: apiKeyPepperId(first),
        current: false,
      },
      {
        secretHash: hashApiKeySecret(token, second),
        pepperKeyId: apiKeyPepperId(second),
        current: false,
      },
    ]);
  });

  it('answers only the current hash without earlier peppers', () => {
    expect(apiKeyHashCandidates(token, pepper, [])).toEqual([
      {
        secretHash: hashApiKeySecret(token, pepper),
        pepperKeyId: apiKeyPepperId(pepper),
        current: true,
      },
    ]);
  });

  it('leaves out an earlier pepper equal to the current one, or repeated', () => {
    const ids = (previous: Uint8Array[]) =>
      apiKeyHashCandidates(token, pepper, previous).map(({ pepperKeyId }) => pepperKeyId);

    expect(ids([Buffer.from(pepper), first])).toEqual([
      apiKeyPepperId(pepper),
      apiKeyPepperId(first),
    ]);
    expect(ids([first, first])).toEqual([apiKeyPepperId(pepper), apiKeyPepperId(first)]);
  });

  it(`refuses more than ${String(API_KEY_PREVIOUS_PEPPERS_MAX)} earlier peppers`, () => {
    expect(API_KEY_PREVIOUS_PEPPERS_MAX).toBe(2);
    expect(() => apiKeyHashCandidates(token, pepper, [first, second, randomBytes(32)])).toThrow(
      RangeError,
    );
  });

  it('refuses a short earlier pepper as it refuses a short current one', () => {
    expect(() => apiKeyHashCandidates(token, pepper, [randomBytes(16)])).toThrow(
      /at least 32 bytes/,
    );
  });
});

describe('generateApiKey and the pepper id (C247.1)', () => {
  it('names the pepper its hash was made under', () => {
    expect(generateApiKey('sandbox', pepper).pepperKeyId).toBe(apiKeyPepperId(pepper));
  });
});
