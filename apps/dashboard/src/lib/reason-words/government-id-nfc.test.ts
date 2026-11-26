// @vitest-environment node
/**
 * C51.2, C62.3, C66: every reason a `verification/government-id-nfc` check can give, in words.
 * The contracts' reason list is iterated first, so a code added there without words here fails
 * this test. Each code of the C51.2 table has words of its own here, said for a chip read; the
 * C29.4 shared reasons the registry inputs add (`execution_error`) may take the shared words.
 */
import { NFC_CHECK_IDS, NFC_CHECK_OUTCOMES, NFC_CHECK_REASONS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { reasonText } from '../check-reasons';
import { GOVERNMENT_ID_NFC_REASON_WORDS as WORDS_OF } from './government-id-nfc';

/** Short words: a capital first, no code, at most 60 characters (as `index.test.ts` asks). */
const WORDS = /^[A-Z][^_]{1,59}$/;

const EVERY_REASON = NFC_CHECK_IDS.flatMap((check) =>
  NFC_CHECK_REASONS[check].map((code): [string, string] => [check, code]),
);

const TABLE_REASONS = [
  ...new Set(
    NFC_CHECK_IDS.flatMap((check) => [
      ...NFC_CHECK_OUTCOMES[check].failed,
      ...NFC_CHECK_OUTCOMES[check].notApplicable,
    ]),
  ),
];

describe('the chip reasons in words (C51.2, C62.3, C66)', () => {
  it('reads every chip check and reason from the contracts', () => {
    expect(NFC_CHECK_IDS).toHaveLength(6);
    expect(EVERY_REASON.length).toBeGreaterThanOrEqual(TABLE_REASONS.length);
  });

  it.each(EVERY_REASON)('%s says %s in words', (check, code) => {
    expect(reasonText(code, check)?.words, code).toMatch(WORDS);
  });

  it.each(TABLE_REASONS)('words %s for a chip itself', (code) => {
    expect(Object.hasOwn(WORDS_OF, code), code).toBe(true);
  });

  it('tells proven tampering from a gap of the trust store, which goes to review (C62.3)', () => {
    expect(WORDS_OF.dg_hash_mismatch?.explanation).toMatch(/tamper/);
    expect(WORDS_OF.sod_signature_invalid?.explanation).toMatch(/tamper/);
    for (const code of ['trust_anchor_unavailable', 'crl_unavailable', 'certificate_expired']) {
      expect(WORDS_OF[code]?.explanation, code).toMatch(/review/);
    }
  });

  it('never says a non-blocking answer or an unverified match is a pass (C62.4, decision 33)', () => {
    expect(WORDS_OF.chip_auth_not_server_verifiable?.explanation).toMatch(
      /no Active Authentication key/,
    );
    expect(WORDS_OF.integrity_not_established?.explanation).toMatch(/never counts as a pass/);
    expect(WORDS_OF.chip_seen_on_other_account?.explanation).toMatch(/selfie/);
  });

  it('compares the chip with the printed MRZ, not the MRZ with itself', () => {
    expect(WORDS_OF.document_number_mismatch?.words).toBe('Document number differs from the ID');
    expect(WORDS_OF.name_mismatch?.words).toBe('Name differs from the ID');
  });
});
