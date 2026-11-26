// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import { checksSource, valuesOf } from '../testing/checks-source';
import {
  EMAIL_ADDRESS_PASS_MEANS,
  disposableMatchText,
  matchDepthText,
  mxRouteText,
} from './email-address-words';

/** `docs/checks/contact.md`, "What a pass means", as plain words. */
const SECTION = passMeansSection('contact.md').toLowerCase();
/**
 * What the disposable check records as `match`: a match's kind (`disposable-domains.ts`) or
 * `none` (the evaluator); and how the MX check found its answer (`route`).
 */
const MATCHES = [
  ...valuesOf(checksSource('contact/email-address-disposable-detection.ts'), 'match'),
  ...valuesOf(checksSource('contact/disposable-domains.ts'), 'kind'),
];
const ROUTES = valuesOf(checksSource('contact/email-address-mx-detection.ts'), 'route');
/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;

describe('what an email address pass means (C66)', () => {
  it('says what the docs say an email pass shows, sentence by sentence', () => {
    const sentences = sentencesOf(EMAIL_ADDRESS_PASS_MEANS);

    expect(sentences.length).toBeGreaterThanOrEqual(3);
    for (const sentence of sentences.slice(0, -1)) {
      expect(SECTION, sentence).toContain(sentence.toLowerCase());
    }
  });

  it('says what it does not establish, as the docs do', () => {
    expect(SECTION).toContain('neither establishes who the person is');
    expect(sentencesOf(EMAIL_ADDRESS_PASS_MEANS).at(-1)).toMatch(
      /^It does not establish who the person is, that the address belongs to them/,
    );
  });
});

describe('the email domain checks in words (C56, C66)', () => {
  it('reads the four disposable matches and the five MX routes from the evaluators', () => {
    expect(MATCHES).toEqual(['none', 'allowed', 'denied', 'listed']);
    expect([...ROUTES].sort()).toEqual(['implicit', 'mx', 'null_mx', 'nxdomain', 'reserved']);
  });

  it.each(MATCHES)('says the disposable match %s in words, with what it means', (match) => {
    expect(disposableMatchText(match)?.words, match).toMatch(WORDS);
    expect(disposableMatchText(match)?.explanation, match).toMatch(SENTENCE);
  });

  it.each(ROUTES)('says the MX route %s in words, with what it means', (route) => {
    expect(mxRouteText(route)?.words, route).toMatch(WORDS);
    expect(mxRouteText(route)?.explanation, route).toMatch(SENTENCE);
  });

  it('says how far above the address its domain matched', () => {
    expect(matchDepthText(0)).toBe("The address's own domain");
    expect(matchDepthText(1)).toBe('The domain above it');
    expect(matchDepthText(3)).toBe("3 levels above the address's domain");
  });

  it.each(['constructor', 'toString', 'spam', 7, null])(
    'knows nothing of %s, a value it was not given words for',
    (value) => {
      expect(disposableMatchText(value)).toBeUndefined();
      expect(mxRouteText(value)).toBeUndefined();
    },
  );
});
