/**
 * C51.2, C66: every reason the crypto wallet checks can give, in words. The reasons are read from
 * the contracts (`checkReasonsOfType`), so one added there without words here fails this test.
 */
import { describe, expect, it } from 'vitest';
import { checkReasonsOfType } from '../../testing/phase5-reasons';
import { reasonText } from '../check-reasons';
import { CRYPTO_WALLET_REASON_WORDS } from './crypto-wallet';

const REASONS = checkReasonsOfType('verification/crypto-wallet');
/** Short words: a capital first, no code, at most 60 characters. */
const WORDS = /^[A-Z][^_]{1,59}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;
/** The codes only the crypto wallet checks give, which no shared word list has. */
const OWN_CODES = [
  'address_invalid',
  'address_checksum_invalid',
  'chain_not_allowed',
  'no_allowlist',
  'statement_mismatch',
  'signature_invalid',
  'signature_address_mismatch',
  'expected_address_mismatch',
  'signature_inconclusive',
  'ownership_proof_unsupported',
  'contract_wallet_not_allowed',
];

describe('the crypto wallet reasons in words (C51.2, C66)', () => {
  it('reads every reason of the four crypto wallet checks from the contracts', () => {
    expect(new Set(REASONS.map(([check]) => check)).size).toBe(4);
    expect(REASONS.map(([, code]) => code)).toEqual(expect.arrayContaining(OWN_CODES));
  });

  it.each(REASONS)('says %s %s in short English words', (check, code) => {
    expect(reasonText(code, check)?.words, code).toMatch(WORDS);
  });

  it.each(OWN_CODES)('words %s itself, with a sentence saying what happened', (code) => {
    expect(CRYPTO_WALLET_REASON_WORDS[code]?.words, code).toMatch(WORDS);
    expect(CRYPTO_WALLET_REASON_WORDS[code]?.explanation, code).toMatch(SENTENCE);
  });

  it('says what goes to review rather than failing: a contract wallet, an unprovable address, an unverifiable form (C57.4)', () => {
    for (const code of [
      'contract_wallet_not_allowed',
      'ownership_proof_unsupported',
      'signature_inconclusive',
    ]) {
      expect(reasonText(code, 'crypto_wallet_address_comparison')?.explanation, code).toMatch(
        /reviewer decides/,
      );
    }
  });

  it('says a missing allowlist never blocks (C51.2)', () => {
    expect(
      reasonText('no_allowlist', 'crypto_wallet_disallowed_chain_detection')?.explanation,
    ).toMatch(/never blocks/);
  });

  it('keeps "Not configured" for an unbound EVM RPC, and says why it goes to review (ADR 0002 §3e, decision 51)', () => {
    const text = reasonText('provider_not_configured', 'crypto_wallet_address_comparison');

    expect(text?.words).toBe('Not configured');
    expect(text?.explanation).toMatch(/EVM RPC.*reviewer decides/);
  });
});
