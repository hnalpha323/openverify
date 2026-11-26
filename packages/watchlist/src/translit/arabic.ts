/**
 * C78.2: ICAO Doc 9303 Part 3 (8th edition, 2021) §6.C, the transliteration of the Arabic script
 * into the MRZ, as our own code (the table is a fact; ICAO's text is not copied).
 *
 * §6.C writes the MRZ: letters that have no single Latin letter take an `X` escape (`ث` is `XTH`),
 * harakat are not encoded, a shadda doubles its letter and a teh marbuta is `XTA`, or `XAH` at the
 * end of a name component. A list never writes names that way, so the matcher reads a second
 * column, ours: the plain Latin letters each code stands for (`th`, `kh`, `sh`, the emphatic
 * letters as their base letter), lower case. Arabic is written without vowels (§6 Appendix B
 * counts at least 32 Latin spellings of one name), so that form is lossy (C78.2): it feeds keys and
 * capped scores only.
 */
import type { Transliteration } from './cyrillic.js';
import { lossyLatin } from './lossy.js';

/** One §6.C row: the MRZ code (`''` for "not encoded") and our plain Latin reading of it. */
export interface ArabicTransliteration {
  readonly mrz: string;
  readonly latin: string;
}

/** §6.C rows as [code point, MRZ code, our plain reading]; `''` codes are "not encoded". */
const ROWS: readonly (readonly [number, string, string])[] = [
  // The letters of Arabic itself.
  [0x0621, 'XE', ''],
  [0x0622, 'XAA', 'a'],
  [0x0623, 'XAE', 'a'],
  [0x0624, 'U', 'u'],
  [0x0625, 'I', 'i'],
  [0x0626, 'XI', 'i'],
  [0x0627, 'A', 'a'],
  [0x0628, 'B', 'b'],
  [0x0629, 'XTA', 't'],
  [0x062a, 'T', 't'],
  [0x062b, 'XTH', 'th'],
  [0x062c, 'J', 'j'],
  [0x062d, 'XH', 'h'],
  [0x062e, 'XKH', 'kh'],
  [0x062f, 'D', 'd'],
  [0x0630, 'XDH', 'dh'],
  [0x0631, 'R', 'r'],
  [0x0632, 'Z', 'z'],
  [0x0633, 'S', 's'],
  [0x0634, 'XSH', 'sh'],
  [0x0635, 'XSS', 's'],
  [0x0636, 'XDZ', 'd'],
  [0x0637, 'XTT', 't'],
  [0x0638, 'XZZ', 'z'],
  [0x0639, 'E', 'a'],
  [0x063a, 'G', 'gh'],
  [0x0640, '', ''],
  [0x0641, 'F', 'f'],
  [0x0642, 'Q', 'q'],
  [0x0643, 'K', 'k'],
  [0x0644, 'L', 'l'],
  [0x0645, 'M', 'm'],
  [0x0646, 'N', 'n'],
  [0x0647, 'H', 'h'],
  [0x0648, 'W', 'w'],
  [0x0649, 'XAY', 'a'],
  [0x064a, 'Y', 'y'],
  // Harakat, sukun and the superscript alef: not encoded.
  [0x064b, '', ''],
  [0x064c, '', ''],
  [0x064d, '', ''],
  [0x064e, '', ''],
  [0x064f, '', ''],
  [0x0650, '', ''],
  [0x0652, '', ''],
  [0x0670, '', ''],
  // The national characters §6.C lists (Persian, Urdu, Pashto and others).
  [0x0671, 'XXA', 'a'],
  [0x0679, 'XXT', 't'],
  [0x067c, 'XRT', 't'],
  [0x067e, 'P', 'p'],
  [0x0681, 'XKE', 'dz'],
  [0x0685, 'XXH', 'ts'],
  [0x0686, 'XC', 'ch'],
  [0x0688, 'XXD', 'd'],
  [0x0689, 'XDR', 'd'],
  [0x0691, 'XXR', 'r'],
  [0x0693, 'XRR', 'r'],
  [0x0696, 'XRX', 'zh'],
  [0x0698, 'XJ', 'zh'],
  [0x069a, 'XXS', 'sh'],
  [0x069c, '', ''],
  [0x06a2, '', ''],
  [0x06a7, '', ''],
  [0x06a8, '', ''],
  [0x06a9, 'XKK', 'k'],
  [0x06ab, 'XXK', 'g'],
  [0x06ad, 'XNG', 'ng'],
  [0x06af, 'XGG', 'g'],
  [0x06ba, 'XNN', 'n'],
  [0x06bc, 'XXN', 'n'],
  [0x06be, 'XDO', 'h'],
  [0x06c0, 'XYH', 'h'],
  [0x06c1, 'XXG', 'h'],
  [0x06c2, 'XGE', 'h'],
  [0x06c3, 'XTG', 't'],
  [0x06cc, 'XYA', 'y'],
  [0x06cd, 'XXY', 'y'],
  [0x06d0, 'Y', 'y'],
  [0x06d2, 'XYB', 'e'],
  [0x06d3, 'XBE', 'e'],
];

/** §6.C by code point, with our plain reading; the shadda (U+0651) doubles and is not listed. */
export const ICAO_ARABIC_TRANSLITERATIONS: ReadonlyMap<number, ArabicTransliteration> = new Map(
  ROWS.map(([codePoint, mrz, latin]) => [codePoint, Object.freeze({ mrz, latin })] as const),
);

const SHADDA = 0x0651;
const TEH_MARBUTA = 0x0629;
/** §6.C note 2: a teh marbuta ending a name component is XAH; our plain reading is `a`. */
const FINAL_TEH_MARBUTA: ArabicTransliteration = Object.freeze({ mrz: 'XAH', latin: 'a' });
const ARABIC = /\p{Script=Arabic}/u;
const LETTER = /\p{L}/u;
const isArabicLetter = (character: string) => ARABIC.test(character) && LETTER.test(character);

/**
 * Walks `text`, rendering each character §6.C lists by `pick` and every other Arabic-script
 * character by `unlisted`; anything else passes unchanged. A shadda repeats the last letter
 * rendered (in NFC it follows the vowel mark of its letter, which renders as nothing).
 */
function render(
  text: string,
  pick: (row: ArabicTransliteration) => string,
  unlisted: (character: string) => string,
): string {
  const characters = Array.from(text.normalize('NFC'));
  let out = '';
  let previous = '';
  characters.forEach((character, index) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === SHADDA) {
      out += previous;
      return;
    }
    let row = ICAO_ARABIC_TRANSLITERATIONS.get(codePoint);
    if (row === undefined && !ARABIC.test(character)) {
      out += character;
      previous = '';
      return;
    }
    if (codePoint === TEH_MARBUTA && !isArabicLetter(characters[index + 1] ?? '')) {
      row = FINAL_TEH_MARBUTA;
    }
    const rendered = row === undefined ? unlisted(character) : pick(row);
    if (row?.mrz !== '') {
      previous = rendered;
    }
    out += rendered;
  });
  return out;
}

/** The §6.C MRZ rendering of the Arabic-script letters of `text` (upper case, `X` escapes). */
export function icaoArabicMrz(text: string): string {
  return render(
    text,
    (row) => row.mrz,
    () => '',
  );
}

/** The plain Latin reading of `text` (lower case); never reliable (C78.2). */
export function transliterateArabic(text: string): Transliteration {
  return { latin: render(text, (row) => row.latin, lossyLatin), reliable: false };
}
