// @vitest-environment node
/**
 * C59.4–C59.6, C66: the AAMVA vocabulary in words: the two sources the contracts name, every
 * answer the evidence can give a field, the template's two choices for a jurisdiction that does
 * not take part, and what a pass means.
 */
import { AAMVA_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { AAMVA_NON_PARTICIPATION_OUTCOMES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import type { AamvaFieldAnswer } from './aamva-evidence';
import {
  AAMVA_COPIED_FROM,
  AAMVA_PASS_MEANING,
  aamvaFieldAnswerText,
  aamvaSourceText,
  nonParticipationText,
} from './aamva-words';

const WORDS = /^[A-Z][^_]{1,79}$/;
const SENTENCE = /^[A-Z][^_]+\.$/;

/** Every answer `AamvaFieldAnswer` names; a missing one fails the typecheck. */
const ANSWERS = Object.keys({
  'no-difference': true,
  differs: true,
  ignored: true,
  'no-record': true,
  'not-compared': true,
  'not-recorded': true,
  routing: true,
} satisfies Record<AamvaFieldAnswer, true>);

describe('the AAMVA vocabulary in words (C59.4–C59.6, C66)', () => {
  it.each(AAMVA_VERIFICATION_ATTRIBUTES.source.unwrap().unwrap().options)(
    'says the source %s, and what it means',
    (source) => {
      expect(aamvaSourceText(source).words).toMatch(WORDS);
      expect(aamvaSourceText(source).explanation).toMatch(SENTENCE);
    },
  );

  it('says the silent step’s values were copied by the server, and the form’s entered by the user', () => {
    expect(aamvaSourceText('government_id').explanation).toMatch(/copied/);
    expect(aamvaSourceText('form').explanation).toMatch(/entered/);
    expect(AAMVA_COPIED_FROM).toMatch(/does not name/);
  });

  it.each(ANSWERS)('says the field answer %s', (answer) => {
    expect(aamvaFieldAnswerText(answer)?.words).toMatch(WORDS);
  });

  it('never says a field the result does not name was matched', () => {
    expect(aamvaFieldAnswerText('no-difference').words).toBe('No difference reported');
    expect(aamvaFieldAnswerText('not-recorded').explanation).toMatch(/does not say/);
    expect(aamvaFieldAnswerText('ignored').explanation).toMatch(/ignored fields/);
  });

  it.each(AAMVA_NON_PARTICIPATION_OUTCOMES)('says the choice %s', (outcome) => {
    expect(nonParticipationText(outcome)).toMatch(WORDS);
  });

  it.each(['form-ish', 'constructor'])('knows nothing of %s', (value) => {
    expect(aamvaSourceText(value)).toBeUndefined();
    expect(aamvaFieldAnswerText(value)).toBeUndefined();
    expect(nonParticipationText(value)).toBeUndefined();
  });

  it('says what a pass means as `docs/checks/database.md` says it, sentence by sentence', () => {
    const section = passMeansSection('database.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(AAMVA_PASS_MEANING);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(AAMVA_PASS_MEANING).toMatch(/^The issuing jurisdiction's records hold/);
    expect(AAMVA_PASS_MEANING).toMatch(/does not show that the card is in the user's hands/);
  });
});
