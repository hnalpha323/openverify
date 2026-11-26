/** Solana ownership: RFC 8032 strict ed25519 and the curve test (C57.1). */
import { base58, base64, hex } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.js';
import { decodeSolanaSignature, isOnEd25519Curve, verifySolanaSignature } from './solana.js';
import { signSolanaMessage, solanaProgramDerivedAddress, solanaTestKey } from './testing.js';

describe('Solana ownership (C57.1)', () => {
  it('verifies RFC 8032 §7.1 test 1 (its public key, empty message and signature)', () => {
    const publicKey = hex.decode(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
    const signature = hex.decode(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    );
    expect(verifySolanaSignature(publicKey, new Uint8Array(), signature)).toBe(true);
    expect(verifySolanaSignature(publicKey, utf8('x'), signature)).toBe(false);
  });

  it('verifies a seeded wallet’s signature and refuses another key’s or message', () => {
    const alice = solanaTestKey('alice');
    const bob = solanaTestKey('bob');
    const message = utf8('verify.example.org wants you to sign in with your Solana account:');
    const signature = decodeSolanaSignature(signSolanaMessage(message, alice.seed));
    if (signature === null) {
      throw new Error('signature');
    }
    expect(verifySolanaSignature(alice.publicKey, message, signature)).toBe(true);
    expect(verifySolanaSignature(bob.publicKey, message, signature)).toBe(false);
    expect(verifySolanaSignature(alice.publicKey, utf8('other'), signature)).toBe(false);
  });

  it('reads base58 and padded base64 signatures of 64 bytes only', () => {
    const bytes = new Uint8Array(64).fill(9);
    expect(decodeSolanaSignature(base58.encode(bytes))).toEqual(bytes);
    expect(decodeSolanaSignature(base64.encode(bytes))).toEqual(bytes);
    expect(decodeSolanaSignature(base58.encode(new Uint8Array(63).fill(9)))).toBeNull();
    expect(decodeSolanaSignature('not a signature')).toBeNull();
    expect(decodeSolanaSignature('1'.repeat(10_000))).toBeNull();
  });

  it('tells keys on the curve from program-derived addresses', () => {
    expect(isOnEd25519Curve(solanaTestKey('alice').publicKey)).toBe(true);
    const pda = solanaProgramDerivedAddress([utf8('vault')], solanaTestKey('program').publicKey);
    expect(isOnEd25519Curve(pda)).toBe(false);
  });
});
