/** Solana off-chain message envelopes (sRFC 3; `@solana/offchain-messages` v0 and v1 layouts). */
import { describe, expect, it } from 'vitest';
import { isSolanaOffchainEnvelope, unwrapSolanaOffchainMessage } from './solana-offchain.js';
import { solanaOffchainEnvelope, solanaTestKey } from './testing.js';

const content = new TextEncoder().encode('verify.example.org wants you to sign in');
const alice = solanaTestKey('offchain/alice').publicKey;
const bob = solanaTestKey('offchain/bob').publicKey;

describe('Solana off-chain envelopes', () => {
  it('unwraps a version 1 envelope: its sorted signatories and its content', () => {
    const envelope = solanaOffchainEnvelope(1, content, [alice, bob]);
    expect(isSolanaOffchainEnvelope(envelope)).toBe(true);
    const unwrapped = unwrapSolanaOffchainMessage(envelope);
    expect(unwrapped?.version).toBe(1);
    expect(unwrapped?.content).toEqual(content);
    expect(unwrapped?.signatories).toHaveLength(2);
    expect(
      unwrapped?.signatories.some((key) => key.every((byte, index) => byte === alice[index])),
    ).toBe(true);
  });

  it('unwraps a version 0 envelope with its application domain, format and length', () => {
    const unwrapped = unwrapSolanaOffchainMessage(solanaOffchainEnvelope(0, content, [alice]));
    expect(unwrapped).toEqual({ version: 0, signatories: [alice], content });
  });

  it('does not take plain bytes for an envelope', () => {
    expect(isSolanaOffchainEnvelope(content)).toBe(false);
    expect(unwrapSolanaOffchainMessage(content)).toBeNull();
  });

  it.each([
    ['a truncated envelope', solanaOffchainEnvelope(1, content, [alice]).slice(0, 20)],
    ['no signatory', solanaOffchainEnvelope(1, content, [])],
    ['empty content', solanaOffchainEnvelope(1, new Uint8Array(), [alice])],
    ['a duplicate signatory', solanaOffchainEnvelope(1, content, [alice, alice])],
    [
      'version 2',
      (() => {
        const envelope = solanaOffchainEnvelope(1, content, [alice]);
        envelope[16] = 2;
        return envelope;
      })(),
    ],
    [
      'a version 0 length that disagrees with the content',
      (() => {
        const envelope = solanaOffchainEnvelope(0, content, [alice]);
        return envelope.slice(0, -1);
      })(),
    ],
    [
      'version 1 signatories out of order',
      (() => {
        const hexOf = (key: Uint8Array) =>
          Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('');
        const [low, high] = [alice, bob].sort((a, b) => hexOf(a).localeCompare(hexOf(b)));
        const envelope = solanaOffchainEnvelope(1, content, [alice, bob]);
        envelope.set(high ?? new Uint8Array(32), 18);
        envelope.set(low ?? new Uint8Array(32), 50);
        return envelope;
      })(),
    ],
  ])('refuses %s', (_why, envelope) => {
    expect(unwrapSolanaOffchainMessage(envelope)).toBeNull();
  });
});
