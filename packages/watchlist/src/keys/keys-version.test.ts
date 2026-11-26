/** C78.3 (V04): the keys version joins every normaliser version and the group file's digest. */
import { describe, expect, it } from 'vitest';
import { CRYPTO_NORMALISER_VERSION } from '../crypto/index.js';
import { IDENTIFIER_NORMALISER_VERSION, KEYS_VERSION, keysVersion } from './index.js';

describe('keysVersion', () => {
  it('joins the name, identifier and crypto rule versions with the group file digest', () => {
    const digest = '0123456789abcdef'.repeat(4);
    expect(keysVersion(digest)).toBe(
      `${KEYS_VERSION};${IDENTIFIER_NORMALISER_VERSION};${CRYPTO_NORMALISER_VERSION};groups-${digest}`,
    );
    expect(keysVersion(digest).length).toBeLessThanOrEqual(200);
  });

  it('refuses anything but a lower-case SHA-256', () => {
    expect(() => keysVersion('abc')).toThrow(/SHA-256/);
    expect(() => keysVersion('A'.repeat(64))).toThrow(/SHA-256/);
  });
});
