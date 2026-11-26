/**
 * C161.1, C161.5, C161.6 (decisions 30, 31, 67): the five built-in catalogs. Each non-English
 * catalog has every English key (a missing one fails the type check, a stray one this test), keeps
 * every placeholder in its own `{{name}}` syntax, and is translated. The French, German and Arabic
 * catalogs were drafted by build agents, which is machine translation; they ship machine-drafted.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGS } from './catalogs';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages';

interface Tree {
  readonly [key: string]: string | Tree;
}

function leaves(tree: Tree, prefix = ''): [key: string, message: string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  );
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** The message's key without its plural suffix: `document.pages_one` is `document.pages`. */
function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1] ?? '');
}

const english = new Map(leaves(CATALOGS.en));
const englishBases = new Set([...english.keys()].map(baseKey));

/** The English message a key of another catalog translates (a plural form: its `_other`). */
function englishFor(key: string): string | undefined {
  return english.get(key) ?? english.get(`${baseKey(key)}_other`);
}

/**
 * Messages that read the same as in English, each for its reason: product and network names,
 * a message made of placeholders only, and words that are the same in that language.
 */
const SAME_AS_ENGLISH: Readonly<Record<Exclude<SupportedLanguage, 'en'>, readonly string[]>> = {
  es: [],
  // « Code » and « Signature » are French words too.
  fr: ['otp.code.label', 'cryptoWallet.paste.signature'],
  // „Person {{number}}“ is German too.
  de: ['forms.persons.person'],
  ar: [],
};

/** Names, written the same in every language. */
const NAMES = /^(app\.name|cryptoWallet\.chains\.(?!evm$|bitcoinTestnet$|sepolia$)\w+)$/;
/** Messages made of placeholders and punctuation only. */
const ONLY_PLACEHOLDERS = new Set(['otp.phone.countryOption']);

describe.each(SUPPORTED_LANGUAGES.filter((language) => language !== 'en'))(
  'the %s catalog',
  (language) => {
    const messages = leaves(CATALOGS[language]);

    it('has every English message and nothing else (plural forms aside)', () => {
      const keys = new Set(messages.map(([key]) => key));
      const stray = [...keys].filter((key) => !english.has(key) && !englishBases.has(baseKey(key)));
      const missing = [...english.keys()].filter(
        (key) => !keys.has(key) && !PLURAL_SUFFIX.test(key),
      );

      expect(stray).toEqual([]);
      expect(missing).toEqual([]);
    });

    it('keeps every placeholder in its own {{name}} syntax', () => {
      const wrong = messages.flatMap(([key, message]) => {
        const source = englishFor(key) ?? '';
        const expected = new Set(placeholders(source));
        const actual = new Set(placeholders(message));
        // A plural form may say its count in words (Arabic "two days"), never another value.
        const plural = PLURAL_SUFFIX.test(key);
        const lost = [...expected].filter(
          (name) => !actual.has(name) && !(plural && name === 'count'),
        );
        const added = [...actual].filter((name) => !expected.has(name));
        const unfilled = /\{(?!\{)[a-z]+\}|\{\{[^}]*$/.test(
          message.replace(/\{\{\s*\w+\s*\}\}/g, ''),
        );
        return lost.length > 0 || added.length > 0 || unfilled ? [{ key, lost, added }] : [];
      });

      expect(wrong).toEqual([]);
    });

    it('is translated: no message reads as in English unless it is a name or the same word', () => {
      const allowed = new Set(SAME_AS_ENGLISH[language]);
      const untranslated = messages
        .filter(([key, message]) => message === englishFor(key))
        .map(([key]) => key)
        .filter((key) => !NAMES.test(key) && !ONLY_PLACEHOLDERS.has(key) && !allowed.has(key));

      expect(untranslated).toEqual([]);
    });

    it('never names the person by a gendered form (C161.6)', () => {
      // The flow knows nothing reliable about a person's gender: no "(e)", "/in" or inclusive dot.
      const gendered = messages.filter(([, message]) =>
        /\(e\)|\(s\)e|[a-zäöüß]\/in\b|[a-zäöüß]:innen|[a-zà-ÿ]·e\b/i.test(message),
      );

      expect(gendered).toEqual([]);
    });
  },
);

describe('the Arabic catalog', () => {
  it('is written in Arabic script, with Latin only for names, codes and examples', () => {
    const latinOnly = leaves(CATALOGS.ar).filter(
      ([key, message]) => !/[؀-ۿ]/.test(message) && !NAMES.test(key) && !ONLY_PLACEHOLDERS.has(key),
    );

    expect(latinOnly).toEqual([]);
  });
});
