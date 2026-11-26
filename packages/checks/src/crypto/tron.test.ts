/** TRON `signMessageV2` (TronWeb `utils/message.ts`) over seeded keys. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hex } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { concatBytes, utf8 } from './bytes.js';
import { recoverTronSigner, tronAddressOf, tronMessageDigest } from './tron.js';
import { signTronMessage, testPrivateKey, tronTestAddress } from './testing.js';

describe('TRON signMessageV2 (C57.1)', () => {
  it('digests the TRON prefix, the decimal byte length and the message with Keccak-256', () => {
    for (const message of ['', 'hello', 'Grüße', 'x'.repeat(300)]) {
      const bytes = utf8(message);
      const expected = keccak_256(
        concatBytes(
          utf8(`${String.fromCharCode(0x19)}TRON Signed Message:\n${String(bytes.length)}`),
          bytes,
        ),
      );
      expect(hex.encode(tronMessageDigest(bytes))).toBe(hex.encode(expected));
    }
  });

  it('encodes the zero account as the published black-hole address', () => {
    expect(tronAddressOf(Uint8Array.from([0x41, ...new Uint8Array(20)]))).toBe(
      'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    );
  });

  it('recovers the signer of seeded signatures, with or without 0x and with v 0/1', () => {
    for (let index = 0; index < 10; index += 1) {
      const key = testPrivateKey(`tron/sign/${String(index)}`);
      const message = utf8(`challenge ${String(index)}`);
      const signature = hex.decode(signTronMessage(message, key).slice(2));
      expect(recoverTronSigner(tronMessageDigest(message), signature)).toEqual({
        address: tronTestAddress(key),
        highS: false,
      });
      const yParity = Uint8Array.from(signature);
      yParity[64] = (yParity[64] ?? 27) - 27;
      expect(recoverTronSigner(tronMessageDigest(message), yParity)?.address).toBe(
        tronTestAddress(key),
      );
    }
  });

  it('recovers nothing from a malformed signature', () => {
    expect(recoverTronSigner(tronMessageDigest(utf8('x')), new Uint8Array(64))).toBeNull();
  });
});
