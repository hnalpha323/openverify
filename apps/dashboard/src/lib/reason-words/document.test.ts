// @vitest-environment node
/**
 * C51.2, C66: every reason a `verification/document` check can give, in words. The contracts'
 * reason list is iterated first, so a code added there without words here fails this test. Each
 * code of the C51.2 table has words of its own here, said for a proof-of-address document; the
 * C29.4 shared reasons the registry inputs add (`execution_error`) may take the shared words.
 */
import {
  DOCUMENT_CHECK_IDS,
  DOCUMENT_CHECK_OUTCOMES,
  DOCUMENT_CHECK_REASONS,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { reasonText } from '../check-reasons';
import { DOCUMENT_REASON_WORDS } from './document';

/** Short words: a capital first, no code, at most 60 characters (as `index.test.ts` asks). */
const WORDS = /^[A-Z][^_]{1,59}$/;

const EVERY_REASON = DOCUMENT_CHECK_IDS.flatMap((check) =>
  DOCUMENT_CHECK_REASONS[check].map((code): [string, string] => [check, code]),
);

const TABLE_REASONS = [
  ...new Set(
    DOCUMENT_CHECK_IDS.flatMap((check) => [
      ...DOCUMENT_CHECK_OUTCOMES[check].failed,
      ...DOCUMENT_CHECK_OUTCOMES[check].notApplicable,
    ]),
  ),
];

describe('the document reasons in words (C51.2, C66)', () => {
  it('reads every document check and reason from the contracts', () => {
    expect(DOCUMENT_CHECK_IDS).toHaveLength(7);
    expect(EVERY_REASON.length).toBeGreaterThanOrEqual(TABLE_REASONS.length);
  });

  it.each(EVERY_REASON)('%s says %s in words', (check, code) => {
    expect(reasonText(code, check)?.words, code).toMatch(WORDS);
  });

  it.each(TABLE_REASONS)('words %s for a document itself', (code) => {
    expect(Object.hasOwn(DOCUMENT_REASON_WORDS, code), code).toBe(true);
  });

  it('says an unrecognised document goes to review, never that it was refused', () => {
    expect(DOCUMENT_REASON_WORDS.document_type_unknown?.words).toBe('Document not recognised');
    expect(DOCUMENT_REASON_WORDS.document_type_unknown?.explanation).toMatch(/review/);
    expect(DOCUMENT_REASON_WORDS.document_type_not_accepted?.explanation).toMatch(
      /identity document/,
    );
  });

  it('says each fabrication reason is a trace of an edit, not proof of one', () => {
    const fabrication = DOCUMENT_CHECK_OUTCOMES.document_fabrication_detection.failed;
    for (const code of fabrication) {
      expect(DOCUMENT_REASON_WORDS[code]?.explanation, code).toMatch(/\.$/);
    }
    expect(DOCUMENT_REASON_WORDS.pdf_hidden_text?.words).toBe('Hidden or covered text');
    expect(DOCUMENT_REASON_WORDS.image_tampered?.explanation).toMatch(/copy-move|compression/);
  });

  it('explains what a gated check was missing', () => {
    expect(DOCUMENT_REASON_WORDS.input_missing?.explanation).toMatch(/class/);
    expect(DOCUMENT_REASON_WORDS.feature_absent?.explanation).toMatch(/lease/);
  });
});
