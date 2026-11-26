/**
 * C238.3, C238.9, C237.4 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 4): the
 * share-consent text's logical form. The texts here are synthetic test sentences, not the built-in
 * catalog texts (`clients-connect` writes those). The digest is asserted by Phase 9's algorithm
 * (`consentTextDigest`: NFC, UTF-8, SHA-256 in hex), pinned for one composition.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../analytics/testing/random.js';
import { SHARE_CATEGORIES, type ShareCategory } from './categories.js';
import {
  SHARE_CONSENT_TEXT_KEYS,
  SHARE_TEXT_PLACEHOLDERS,
  categoriesInWords,
  composeShareConsentText,
  durationInWords,
  type ShareTextTemplate,
  type ShareTextValues,
} from './share-consent-text.js';

const WORDS: Readonly<Record<ShareCategory, string>> = {
  'identity-fields': 'identity details',
  'contact-fields': 'contact details',
  'other-fields': 'other details',
  'document-images': 'document images',
  biometric: 'biometric data',
  'check-results': 'verification results',
};

const VALUES: ShareTextValues = {
  locale: 'en',
  source: 'Example Source',
  recipient: 'Example Partner',
  categories: ['check-results', 'identity-fields', 'biometric'],
  categoryWords: WORDS,
  validSeconds: 1_209_600,
  withdraw: 'Write to privacy@example.com',
  retention: { days: 365 },
};

const SOURCE_PLACEHOLDERS = ['source', 'recipient', 'categories', 'expires', 'withdraw'];
const DESTINATION_PLACEHOLDERS = [...SOURCE_PLACEHOLDERS, 'retention'];

const operator = (
  text: string,
  placeholders: readonly string[] = SOURCE_PLACEHOLDERS,
  key = 'share.consent.source',
): ShareTextTemplate => ({ key, text, builtIn: false, placeholders });

const MAIN =
  '{source} shares your {categories} with {recipient}. The consent lasts {expires}. To withdraw: {withdraw}';
const EXPECTED =
  'Example Source shares your identity details, biometric data, and verification results with Example Partner. The consent lasts 14 days. To withdraw: Write to privacy@example.com';

const sha256 = (text: string) =>
  createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');

const bodyOf = (parts: readonly ShareTextTemplate[], values: ShareTextValues = VALUES) => {
  const composed = composeShareConsentText(parts, values);
  if (!composed.ok) throw new Error(`expected a text, got ${composed.problem}`);
  return composed;
};

describe('the keys and placeholders (C238.3)', () => {
  it('closes the placeholder list and names each side’s keys', () => {
    expect(SHARE_TEXT_PLACEHOLDERS).toEqual([
      'source',
      'recipient',
      'categories',
      'expires',
      'withdraw',
      'retention',
    ]);
    expect(SHARE_CONSENT_TEXT_KEYS.source).toEqual({
      title: 'share.consent.title',
      main: 'share.consent.source',
      biometric: 'share.consent.biometric-source',
      accept: 'share.consent.accept',
      decline: 'share.consent.decline',
      withdraw: 'share.consent.withdraw',
    });
    expect(SHARE_CONSENT_TEXT_KEYS.destination.main).toBe('share.consent.destination');
    expect(SHARE_CONSENT_TEXT_KEYS.destination.biometric).toBe(
      'share.consent.biometric-destination',
    );
  });
});

describe('words for the values (C238.3, C238.9)', () => {
  it.each([
    [1_209_600, 'en', '14 days'],
    [86_400, 'en', '1 day'],
    [7_200, 'en', '2 hours'],
    [120, 'en', '2 minutes'],
    [90, 'en', '90 seconds'],
    [1_209_600, 'es', '14 días'],
    // French puts a no-break space between the number and its unit.
    [1_209_600, 'fr', '14\u00a0jours'],
    [1_209_600, 'de', '14 Tage'],
  ])('%i seconds in %s are %s', (seconds, locale, words) => {
    expect(durationInWords(seconds, locale)).toBe(words);
  });

  it.each([0, -60, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s seconds', (seconds) => {
    expect(() => durationInWords(seconds, 'en')).toThrow(RangeError);
  });

  it('lists the categories in the closed order, once each, as the locale joins a list', () => {
    expect(
      categoriesInWords(['check-results', 'identity-fields', 'check-results'], WORDS, 'en'),
    ).toBe('identity details and verification results');
    expect(categoriesInWords([...SHARE_CATEGORIES].reverse(), WORDS, 'en')).toBe(
      'identity details, contact details, other details, document images, biometric data, and verification results',
    );
    expect(categoriesInWords(['identity-fields', 'biometric'], WORDS, 'es')).toBe(
      'identity details y biometric data',
    );
  });
});

describe('the composition (C238.3)', () => {
  it('fills every closed placeholder of an operator text, and the digest is pinned', () => {
    const composed = bodyOf([operator(MAIN)]);
    expect(composed).toEqual({ ok: true, body: EXPECTED, keys: ['share.consent.source'] });
    expect(sha256(composed.body)).toBe(
      'df86395ba69ddfdfb2dbbc504579f25ae42595db981b7f6c0bcca2128e695570',
    );
  });

  it('fills a released built-in text’s double braces and leaves a single brace as written', () => {
    const builtIn: ShareTextTemplate = {
      key: 'share.consent.source',
      text: MAIN.replaceAll('{', '{{').replaceAll('}', '}}'),
      builtIn: true,
      placeholders: SOURCE_PLACEHOLDERS,
    };
    expect(bodyOf([builtIn]).body).toBe(EXPECTED);
    expect(bodyOf([{ ...builtIn, text: 'Shared with {{recipient}} {as written}' }]).body).toBe(
      'Shared with Example Partner {as written}',
    );
  });

  it('joins several parts with a blank line and names their keys in order', () => {
    const composed = bodyOf([
      operator('Sharing with {recipient}', ['recipient'], 'share.consent.title'),
      operator(MAIN),
    ]);
    expect(composed.body).toBe(`Sharing with Example Partner\n\n${EXPECTED}`);
    expect(composed.keys).toEqual(['share.consent.title', 'share.consent.source']);
  });

  it('fills the retention term in days, or the words given', () => {
    const text = operator('Kept for {retention}.', DESTINATION_PLACEHOLDERS, 'd');
    expect(bodyOf([text]).body).toBe('Kept for 365 days.');
    expect(bodyOf([text], { ...VALUES, retention: { words: 'the law’s minimum' } }).body).toBe(
      'Kept for the law’s minimum.',
    );
    expect(bodyOf([operator('No term here.')], { ...VALUES, retention: null }).body).toBe(
      'No term here.',
    );
  });

  it('fills in one pass: a value that looks like a placeholder stays as written', () => {
    expect(
      bodyOf([operator('{withdraw}')], { ...VALUES, withdraw: 'Ask {recipient} at {{source}}' })
        .body,
    ).toBe('Ask {recipient} at {{source}}');
  });

  it('serves NFC whatever the text and the values hold', () => {
    const composed = bodyOf([operator('Café {source}')], {
      ...VALUES,
      source: 'Exámple',
    });
    expect(composed.body).toBe('Café Exámple'.normalize('NFC'));
    expect(composed.body).toBe(composed.body.normalize('NFC'));
  });

  it('refuses no part at all', () => {
    expect(() => composeShareConsentText([], VALUES)).toThrow(RangeError);
  });
});

describe('what never renders (C237.4, C238.9: {withdraw} is never empty)', () => {
  it.each([
    ['an empty withdrawal contact', { withdraw: '' }, 'withdraw_empty', 'withdraw'],
    ['a blank withdrawal contact', { withdraw: ' \t ' }, 'withdraw_empty', 'withdraw'],
    ['an empty source name', { source: '' }, 'value_empty', 'source'],
    ['an empty recipient name', { recipient: '' }, 'value_empty', 'recipient'],
    ['no category', { categories: [] }, 'value_empty', 'categories'],
    [
      'a category without words',
      { categoryWords: { ...WORDS, biometric: '' } },
      'value_empty',
      'categories',
    ],
  ] as [string, Partial<ShareTextValues>, string, string][])(
    'refuses %s',
    (_name, patch, problem, placeholder) => {
      expect(composeShareConsentText([operator(MAIN)], { ...VALUES, ...patch })).toEqual({
        ok: false,
        problem,
        key: 'share.consent.source',
        placeholder,
      });
    },
  );

  it('refuses a retention term the text asks for and the server does not know', () => {
    expect(
      composeShareConsentText([operator('{retention}', DESTINATION_PLACEHOLDERS, 'd')], {
        ...VALUES,
        retention: null,
      }),
    ).toEqual({ ok: false, problem: 'retention_missing', key: 'd', placeholder: 'retention' });
    expect(
      composeShareConsentText([operator('{retention}', DESTINATION_PLACEHOLDERS, 'd')], {
        ...VALUES,
        retention: { words: '' },
      }),
    ).toEqual({ ok: false, problem: 'value_empty', key: 'd', placeholder: 'retention' });
  });

  it('refuses a placeholder outside the key’s closed list or the share list', () => {
    expect(composeShareConsentText([operator('{retention}')], VALUES)).toEqual({
      ok: false,
      problem: 'placeholder_not_allowed',
      key: 'share.consent.source',
      placeholder: 'retention',
    });
    expect(composeShareConsentText([operator('{organization}', ['organization'])], VALUES)).toEqual(
      {
        ok: false,
        problem: 'placeholder_not_allowed',
        key: 'share.consent.source',
        placeholder: 'organization',
      },
    );
  });

  it('never leaves a closed placeholder unfilled in a composed text (seeded)', () => {
    const random = seededRandom(238_3);
    for (let run = 0; run < 1500; run += 1) {
      const used = SHARE_TEXT_PLACEHOLDERS.filter(() => random.chance(0.6));
      const text = used.map((name) => `{${name}}`).join(' / ') || 'plain';
      const values: ShareTextValues = {
        ...VALUES,
        categories: SHARE_CATEGORIES.filter(() => random.chance(0.5)),
        withdraw: random.chance(0.8) ? 'Write to privacy@example.com' : ' ',
        retention: random.pick([{ days: random.int(1, 3650) }, null]),
      };
      const composed = composeShareConsentText(
        [operator(text, DESTINATION_PLACEHOLDERS, 'd')],
        values,
      );
      const label = `run ${String(run)}`;
      if (!composed.ok) {
        expect(used, label).toContain(composed.placeholder);
        continue;
      }
      for (const name of SHARE_TEXT_PLACEHOLDERS) {
        expect(composed.body, label).not.toContain(`{${name}}`);
      }
      if (used.includes('withdraw')) {
        expect(composed.body, label).toContain('Write to privacy@example.com');
      }
      expect(composed.body, label).toBe(composed.body.normalize('NFC'));
    }
  });
});
