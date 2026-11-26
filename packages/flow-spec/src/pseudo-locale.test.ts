/**
 * C161.7 (decision 35; review H26): `en-XA` accents, lengthens and brackets English; `ar-XB`
 * reverses it, to be shown right to left. Both keep every placeholder whole, in either syntax
 * (`{{name}}` in the built-in catalogs, `{name}` in operator copy), so a filled message still fills.
 */
import { describe, expect, it } from 'vitest';
import {
  PSEUDO_LOCALES,
  PSEUDO_LOCALE_DIRECTION,
  isPseudoLocale,
  pseudoLocalize,
  pseudoLocalizeTree,
} from './index.js';

const ASCII_LETTER = /[A-Za-z]/;
const PLACEHOLDERS = /\{\{\s*[A-Za-z0-9_]+\s*\}\}|\{[a-z][a-z0-9_]{0,39}\}/g;
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;

describe('the pseudo-locales', () => {
  it('are en-XA, left to right, and ar-XB, right to left', () => {
    expect(PSEUDO_LOCALES).toEqual(['en-XA', 'ar-XB']);
    expect(PSEUDO_LOCALE_DIRECTION).toEqual({ 'en-XA': 'ltr', 'ar-XB': 'rtl' });
    expect(PSEUDO_LOCALES.every(isPseudoLocale)).toBe(true);
    expect([undefined, 'en', 'ar', 'EN-XA', 3].some(isPseudoLocale)).toBe(false);
  });
});

describe('pseudoLocalize en-XA: accented, lengthened, bracketed', () => {
  it('accents every letter, keeps everything else, and pads with unaccented words', () => {
    expect(pseudoLocalize('en-XA', 'Hi')).toBe('[Ĥî one]');
    expect(pseudoLocalize('en-XA', 'Continue')).toBe('[Ƈöñţîñûé one]');
  });

  it('lengthens a message by at least 40 percent, as translations often are', () => {
    for (const text of ['OK', 'Continue', 'Take a photo of the front of your ID.']) {
      const pseudo = pseudoLocalize('en-XA', text);
      expect(pseudo.length - 2).toBeGreaterThanOrEqual(Math.ceil(text.length * 1.4));
    }
  });

  it('leaves no letter of the message unaccented and keeps its other characters in place', () => {
    const text = 'Photo 1 of 3: look straight — at the camera…';
    const accented = pseudoLocalize('en-XA', text).slice(1, 1 + text.length);

    expect(ASCII_LETTER.test(accented)).toBe(false);
    expect(Array.from(accented).length).toBe(Array.from(text).length);
    expect(accented.replace(/[^\d :—…]/gu, '')).toBe(text.replace(/[^\d :—…]/gu, ''));
  });

  it('keeps placeholders whole in both syntaxes', () => {
    const pseudo = pseudoLocalize(
      'en-XA',
      'Sent to {{destination}} for {organization} in {{ time }}.',
    );

    expect(pseudo.match(PLACEHOLDERS)).toEqual(['{{destination}}', '{organization}', '{{ time }}']);
  });
});

describe('pseudoLocalize ar-XB: reversed, shown right to left', () => {
  it('reverses the message by code point, keeping placeholders whole and in reverse order', () => {
    expect(pseudoLocalize('ar-XB', 'Hello {{name}}!')).toBe('[!{{name}} olleH]');
    expect(pseudoLocalize('ar-XB', '{a} and {{b}}')).toBe('[{{b}} dna {a}]');
  });

  it('reverses characters outside the basic plane whole', () => {
    expect(pseudoLocalize('ar-XB', 'a😀b')).toBe('[b😀a]');
  });
});

describe('both pseudo-locales', () => {
  it.each(PSEUDO_LOCALES)('bracket every message in %s, the empty one too', (locale) => {
    for (const text of ['', 'x', 'Two\nlines', 'Take a selfie']) {
      const pseudo = pseudoLocalize(locale, text);
      expect(pseudo.startsWith('[')).toBe(true);
      expect(pseudo.endsWith(']')).toBe(true);
    }
  });

  it.each(PSEUDO_LOCALES)(
    'add no bidi control in %s (operator copy refuses them, C162.3)',
    (locale) => {
      expect(BIDI_CONTROLS.test(pseudoLocalize(locale, 'Name: {{name}}, code {code}.'))).toBe(
        false,
      );
    },
  );

  it.each(PSEUDO_LOCALES)('are deterministic in %s', (locale) => {
    expect(pseudoLocalize(locale, 'Upload a document')).toBe(
      pseudoLocalize(locale, 'Upload a document'),
    );
  });
});

describe('pseudoLocalizeTree', () => {
  it('transforms every message of a catalog and keeps its shape', () => {
    const tree = { app: { name: 'Flow' }, attempt: 'Attempt {{current}}' } as const;

    expect(pseudoLocalizeTree('ar-XB', tree)).toEqual({
      app: { name: '[wolF]' },
      attempt: '[{{current}} tpmettA]',
    });
    expect(tree.app.name).toBe('Flow');
  });
});
