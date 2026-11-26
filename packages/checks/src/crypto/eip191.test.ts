/** EIP-191 `personal_sign` against the micro-eth-signer oracle (dev only) and seeded keys. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hex } from '@scure/base';
import { addr, eip191Signer } from 'micro-eth-signer';
import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.js';
import { eip191Digest, evmAddressOfPublicKey, recoverEvmSigner } from './eip191.js';
import { evmTestAddress, signPersonalMessage, testPrivateKey } from './testing.js';

const MESSAGES = ['', 'hello', 'Grüße, 世界 ✓', 'line one\nline two', 'x'.repeat(4096)];
const signatureBytes = (signature: string) => hex.decode(signature.slice(2));

describe('EIP-191 (C57.1)', () => {
  it.each(MESSAGES)('digests %j as the oracle does', (message) => {
    expect(`0x${hex.encode(eip191Digest(utf8(message)))}`).toBe(eip191Signer.getHash(message));
  });

  it('recovers the signer of the oracle’s signatures and of ours, with v 27/28 or 0/1', () => {
    for (let index = 0; index < 20; index += 1) {
      const key = testPrivateKey(`eip191/${String(index)}`);
      const expected = addr.fromPrivateKey(key).toLowerCase();
      expect(evmTestAddress(key)).toBe(expected);
      const message = MESSAGES[index % MESSAGES.length] ?? '';
      const oracle = eip191Signer.sign(message, key);
      const ours = signPersonalMessage(utf8(message), key);
      expect(eip191Signer.verify(ours, message, expected)).toBe(true);
      for (const signature of [
        oracle,
        ours,
        signPersonalMessage(utf8(message), key, { yParity: true }),
      ]) {
        expect(recoverEvmSigner(eip191Digest(utf8(message)), signatureBytes(signature))).toEqual({
          address: expected,
          highS: false,
        });
      }
    }
  });

  it('recovers the same signer from the high-s twin and reports it', () => {
    const key = testPrivateKey('eip191/high-s');
    const signature = signPersonalMessage(utf8('hello'), key, { highS: true });
    expect(recoverEvmSigner(eip191Digest(utf8('hello')), signatureBytes(signature))).toEqual({
      address: evmTestAddress(key),
      highS: true,
    });
  });

  it('recovers another address for another message', () => {
    const key = testPrivateKey('eip191/other');
    const signature = signatureBytes(signPersonalMessage(utf8('hello'), key));
    expect(recoverEvmSigner(eip191Digest(utf8('hellO')), signature)?.address).not.toBe(
      evmTestAddress(key),
    );
  });

  it.each([
    ['64 bytes', new Uint8Array(64).fill(1)],
    ['66 bytes', new Uint8Array(66).fill(1)],
    ['v 29', Uint8Array.from([...new Uint8Array(32).fill(1), ...new Uint8Array(32).fill(1), 29])],
    ['r zero', Uint8Array.from([...new Uint8Array(32), ...new Uint8Array(32).fill(1), 27])],
    ['s zero', Uint8Array.from([...new Uint8Array(32).fill(1), ...new Uint8Array(32), 27])],
    [
      'r at the curve order',
      Uint8Array.from([...new Uint8Array(32).fill(0xff), ...new Uint8Array(32).fill(1), 27]),
    ],
  ])('recovers nothing from %s', (_why, signature) => {
    expect(recoverEvmSigner(eip191Digest(utf8('hello')), signature)).toBeNull();
  });

  it('derives one address from a compressed or an uncompressed key', () => {
    const key = testPrivateKey('eip191/key');
    expect(evmAddressOfPublicKey(secp256k1.getPublicKey(key, true))).toBe(evmTestAddress(key));
    expect(evmAddressOfPublicKey(secp256k1.getPublicKey(key, false))).toBe(evmTestAddress(key));
  });
});
