/**
 * C78.2: ICAO Doc 9303 Part 3 (8th edition, 2021) §6.B, the transliteration of Cyrillic
 * characters, as our own code (the table is a fact; ICAO's text is not copied). The base column is
 * used: the language-specific exceptions in brackets (Ukrainian `Г` as `H`, Serbian `Ж` as `Z`,
 * ...) need the name's language, which a list or a query does not state, so the variant groups
 * carry those spellings instead (C78.3). Its output is a reliable form (C78.2), unless the token
 * holds a Cyrillic letter the table does not list, which makes the token lossy.
 */
import { lossyLatin } from './lossy.js';

/** A transliteration: the Latin form (lower case) and whether every letter came from the table. */
export interface Transliteration {
  readonly latin: string;
  readonly reliable: boolean;
}

/** §6.B, keyed by the upper-case letter; `Ь` is not listed and is omitted (ours: MRTD practice). */
export const ICAO_CYRILLIC_TRANSLITERATIONS: Readonly<Record<string, string>> = Object.freeze({
  Ё: 'e',
  Ђ: 'd',
  Є: 'ie',
  Ѕ: 'dz',
  І: 'i',
  Ї: 'i',
  Ј: 'j',
  Љ: 'lj',
  Њ: 'nj',
  Ќ: 'k',
  Ў: 'u',
  Џ: 'dz',
  А: 'a',
  Б: 'b',
  В: 'v',
  Г: 'g',
  Д: 'd',
  Е: 'e',
  Ж: 'zh',
  З: 'z',
  И: 'i',
  Й: 'i',
  К: 'k',
  Л: 'l',
  М: 'm',
  Н: 'n',
  О: 'o',
  П: 'p',
  Р: 'r',
  С: 's',
  Т: 't',
  У: 'u',
  Ф: 'f',
  Х: 'kh',
  Ц: 'ts',
  Ч: 'ch',
  Ш: 'sh',
  Щ: 'shch',
  Ъ: 'ie',
  Ы: 'y',
  Ь: '',
  Э: 'e',
  Ю: 'iu',
  Я: 'ia',
  Ѫ: 'u',
  Ѵ: 'y',
  Ґ: 'g',
  Ғ: 'g',
  Һ: 'c',
});

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** Transliterates the Cyrillic letters of `text` by §6.B; other characters pass unchanged. */
export function transliterateCyrillic(text: string): Transliteration {
  let latin = '';
  let reliable = true;
  for (const character of text.normalize('NFC')) {
    if (!CYRILLIC.test(character)) {
      latin += character;
      continue;
    }
    const listed = ICAO_CYRILLIC_TRANSLITERATIONS[character.toUpperCase()];
    if (listed === undefined) {
      reliable = false;
      latin += lossyLatin(character);
    } else {
      latin += listed;
    }
  }
  return { latin, reliable };
}
