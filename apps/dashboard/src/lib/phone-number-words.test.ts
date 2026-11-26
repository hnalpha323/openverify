// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import { PHONE_NUMBER_PASS_MEANS } from './phone-number-words';

/** `docs/checks/contact.md`, "What a pass means", as plain words. */
const SECTION = passMeansSection('contact.md').toLowerCase();

describe('what a phone number pass means (C66)', () => {
  it('says what the docs say a phone pass shows, sentence by sentence', () => {
    const sentences = sentencesOf(PHONE_NUMBER_PASS_MEANS);

    expect(sentences.length).toBeGreaterThanOrEqual(3);
    for (const sentence of sentences.slice(0, -1)) {
      expect(SECTION, sentence).toContain(sentence.toLowerCase());
    }
  });

  it('says what it does not establish, as the docs do', () => {
    expect(SECTION).toContain('neither establishes who the person is');
    expect(sentencesOf(PHONE_NUMBER_PASS_MEANS).at(-1)).toMatch(
      /^It does not establish who the person is, that the number belongs to them/,
    );
  });
});
