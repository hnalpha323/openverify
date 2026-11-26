/**
 * C62.5: the chip challenge rules that need no database: the nonce is 8 CSPRNG bytes written as
 * 16 lower-case hex characters, its SHA-256 is over those bytes, and the refusals carry their
 * golden problems' codes and details.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CHIP_CHALLENGE_NONCE_HEX_LENGTH } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  chipChallengeInvalid,
  chipDataRequired,
  chipNonceSha256,
  newChipChallengeNonce,
} from './rules.js';

const golden = (code: string) => {
  const url = new URL(
    `../../../../../contracts/fixtures/problems/flow/${code.replaceAll('_', '-')}.json`,
    import.meta.url,
  );
  return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as { detail: string }) : null;
};

describe('newChipChallengeNonce (C62.5)', () => {
  it('writes 8 random bytes as 16 lower-case hex characters', () => {
    const sizes: number[] = [];
    const nonce = newChipChallengeNonce((size) => {
      sizes.push(size);
      return new Uint8Array([0x00, 0x01, 0xab, 0xcd, 0xef, 0x10, 0x7f, 0xff]);
    });

    expect(sizes).toEqual([8]);
    expect(nonce).toBe('0001abcdef107fff');
    expect(nonce).toHaveLength(CHIP_CHALLENGE_NONCE_HEX_LENGTH);
  });

  it('draws a new nonce from the CSPRNG by default', () => {
    const nonces = new Set(Array.from({ length: 32 }, () => newChipChallengeNonce()));

    expect(nonces.size).toBe(32);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[0-9a-f]{16}$/u);
    }
  });
});

describe('chipNonceSha256 (C62.5)', () => {
  it('hashes the nonce bytes, not its hex text', () => {
    expect(chipNonceSha256('0001abcdef107fff')).toBe(
      createHash('sha256').update(Buffer.from('0001abcdef107fff', 'hex')).digest('hex'),
    );
  });
});

describe('the refusals (C52.7)', () => {
  it('answer the golden problems', () => {
    const invalid = chipChallengeInvalid();
    const required = chipDataRequired();

    expect([invalid.code, invalid.message]).toEqual([
      'chip_challenge_invalid',
      golden('chip_challenge_invalid')?.detail,
    ]);
    expect([required.code, required.message]).toEqual([
      'chip_data_required',
      golden('chip_data_required')?.detail,
    ]);
    expect(chipChallengeInvalid('Another detail.').message).toBe('Another detail.');
  });
});
