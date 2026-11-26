/**
 * C238.3, C238.6, C238.10, C237.4 (Phase 11, Workflow 11A; `clients-connect`): the built-in
 * `share.consent.*` texts and the step's own words in every built-in catalog.
 *
 * - Every `share.consent.*` key of Phase 9's `COPY_KEYS` has a text in every locale, within its
 *   length, in NFC, with only its own closed placeholders, written `{{name}}` as a built-in text is.
 * - The main and biometric texts carry every placeholder their key names, so each says who
 *   discloses, the named recipient, the categories, the expiry, how to withdraw and, on the
 *   destination side, the retention term (C238.3, C238.9).
 * - `{withdraw}` never renders empty (C237.4, review H06): composed through `connect-logic`'s
 *   `composeShareConsentText`, the text shows the withdrawal contact, and an empty contact is refused.
 * - Every share category has words in every locale, for the screen and for `{categories}`.
 * - The English texts are pending counsel's review (`counsel-unreviewed`, C238.10).
 * - The locale export carries them, so `consent-texts.json` holds them for the API (C162.9).
 */
import {
  SHARE_CATEGORIES,
  SHARE_CONSENT_TEXT_KEYS,
  composeShareConsentText,
  type ShareCategory,
} from '@openverify/core';
import { COPY_KEYS, COUNSEL_REVIEW_STATUS, flattenMessages } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../i18n/catalogs';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages';
import { consentTextsOf } from '../../i18n/locale-export';

const SHARE_KEYS = Object.keys(COPY_KEYS).filter((key) => key.startsWith('share.consent.'));
const BUILT_IN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function messagesOf(locale: (typeof SUPPORTED_LANGUAGES)[number]): ReadonlyMap<string, string> {
  return new Map(flattenMessages(CATALOGS[locale]));
}

const placeholdersOf = (text: string) => [...text.matchAll(BUILT_IN)].map((match) => match[1]);

function categoryWordsOf(
  locale: (typeof SUPPORTED_LANGUAGES)[number],
): Readonly<Record<ShareCategory, string>> {
  const messages = messagesOf(locale);
  return Object.fromEntries(
    SHARE_CATEGORIES.map((category) => [
      category,
      messages.get(`share.categories.${category}`) ?? '',
    ]),
  ) as Record<ShareCategory, string>;
}

const CONTACT = 'email privacy@example.com';

describe('the share.consent.* keys (C238.3)', () => {
  it('are the eight keys of COPY_KEYS, each legal consent text', () => {
    expect(SHARE_KEYS).toHaveLength(8);
    for (const key of SHARE_KEYS) {
      expect(COPY_KEYS[key]?.legal, key).toBe('consent');
    }
  });

  it('are each pending counsel’s review in English (C238.10)', () => {
    for (const key of SHARE_KEYS) {
      expect(COUNSEL_REVIEW_STATUS[key], key).toBe('counsel-unreviewed');
    }
  });
});

describe.each(SUPPORTED_LANGUAGES)('the share-consent texts in %s', (locale) => {
  const messages = messagesOf(locale);

  it.each(SHARE_KEYS)('%s has a text within its rules', (key) => {
    const text = messages.get(key);
    const rules = COPY_KEYS[key];
    expect(text, key).toEqual(expect.any(String));
    expect(rules).toBeDefined();
    if (text === undefined || rules === undefined) return;
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(rules.maxLength);
    expect(text).toBe(text.normalize('NFC'));
    // Only the key's own closed placeholders, each written as a built-in text writes it.
    expect(new Set(placeholdersOf(text))).toEqual(new Set(rules.placeholders));
    expect(text.replace(BUILT_IN, '')).not.toMatch(/[{}]/);
    if (!rules.multiline) {
      expect(text).not.toContain('\n');
    }
  });

  it('names every share category in words', () => {
    const words = categoryWordsOf(locale);
    for (const category of SHARE_CATEGORIES) {
      expect(words[category].trim().length, category).toBeGreaterThan(0);
      expect(words[category]).toBe(words[category].normalize('NFC'));
    }
  });

  it.each(['source', 'destination'] as const)(
    'composes the %s side’s texts with the withdrawal contact, and never with an empty one (C237.4)',
    (side) => {
      const keys = SHARE_CONSENT_TEXT_KEYS[side];
      const values = {
        locale,
        source: 'Example Source',
        recipient: 'Example Partner',
        categories: [...SHARE_CATEGORIES],
        categoryWords: categoryWordsOf(locale),
        validSeconds: 1_209_600,
        withdraw: CONTACT,
        retention: { days: 30 },
      };
      for (const key of [keys.main, keys.biometric]) {
        const template = {
          key,
          text: messages.get(key) ?? '',
          builtIn: true,
          placeholders: COPY_KEYS[key]?.placeholders ?? [],
        };
        const composed = composeShareConsentText([template], values);
        expect(composed.ok, key).toBe(true);
        if (composed.ok) {
          expect(composed.body).not.toMatch(/\{\{|\}\}/);
          expect(composed.body).toContain('Example Partner');
          if (key === keys.main) {
            expect(composed.body).toContain(CONTACT);
          }
        }
      }
      for (const withdraw of ['', '   ']) {
        expect(
          composeShareConsentText(
            [
              {
                key: keys.main,
                text: messages.get(keys.main) ?? '',
                builtIn: true,
                placeholders: COPY_KEYS[keys.main]?.placeholders ?? [],
              },
            ],
            { ...values, withdraw },
          ),
        ).toMatchObject({ ok: false, problem: 'withdraw_empty' });
      }
    },
  );

  it('never names another vendor', () => {
    for (const [key, text] of messages) {
      if (key.startsWith('share.')) {
        expect(text, key).not.toMatch(/persona/i);
      }
    }
  });
});

describe('the locale export (C162.9)', () => {
  it('carries every share.consent.* text of every locale into consent-texts.json', () => {
    const exported = consentTextsOf(CATALOGS);
    for (const locale of SUPPORTED_LANGUAGES) {
      for (const key of SHARE_KEYS) {
        expect(
          exported.some((entry) => entry.locale === locale && entry.key === key),
          `${locale} ${key}`,
        ).toBe(true);
      }
    }
  });
});
