/**
 * C78.2: the writing system of one name token, and the original-script form two tokens of one
 * script are compared in. Letters of the Common and Inherited scripts (the prolonged-sound mark of
 * kana, combining marks) belong to no writing system and are ignored, so a katakana name with a
 * prolonged-sound mark is still katakana.
 */
import type { WritingSystem } from '@openverify/checks';

/** A token's writing system: one of C58's, `mixed` when its letters span two, `null` with none. */
export type TokenScript = WritingSystem | 'mixed';

/** C58's writing systems (but `other`), each with the Unicode script that defines it. */
const SCRIPT_PATTERNS: readonly (readonly [Exclude<WritingSystem, 'other'>, RegExp])[] = [
  ['latin', /\p{Script=Latin}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['han', /\p{Script=Han}/u],
  ['greek', /\p{Script=Greek}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['hiragana', /\p{Script=Hiragana}/u],
  ['katakana', /\p{Script=Katakana}/u],
  ['armenian', /\p{Script=Armenian}/u],
  ['georgian', /\p{Script=Georgian}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['bengali', /\p{Script=Bengali}/u],
  ['thai', /\p{Script=Thai}/u],
];
const LETTER = /\p{L}/u;
const NO_SCRIPT = /[\p{Script=Common}\p{Script=Inherited}]/u;

/** ASCII letters and digits only: Latin when there is a letter, no script without one. */
const ASCII_WORD = /^[\dA-Za-z]*$/u;
const ASCII_LETTER = /[A-Za-z]/u;

/** The writing system of a token's letters (digits and punctuation have none). */
export function tokenScript(token: string): TokenScript | null {
  if (ASCII_WORD.test(token)) {
    return ASCII_LETTER.test(token) ? 'latin' : null;
  }
  let found: WritingSystem | null = null;
  for (const character of token) {
    if (!LETTER.test(character) || NO_SCRIPT.test(character)) {
      continue;
    }
    const system = SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(character))?.[0] ?? 'other';
    if (found !== null && found !== system) {
      return 'mixed';
    }
    found = system;
  }
  return found;
}

/** Arabic marks no name spells with: Quranic signs, tatweel, harakat and the superscript alef. */
const ARABIC_IGNORED: readonly (readonly [number, number])[] = [
  [0x0610, 0x061a],
  [0x0640, 0x0640],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06ed],
];
/** Letter variants Arabic and Persian spellings interchange (ours): alef forms, yeh, kaf, teh marbuta. */
const ARABIC_VARIANTS: ReadonlyMap<number, string> = new Map([
  [0x0622, '\u0627'],
  [0x0623, '\u0627'],
  [0x0625, '\u0627'],
  [0x0671, '\u0627'],
  [0x0649, '\u064A'],
  [0x06cc, '\u064A'],
  [0x06a9, '\u0643'],
  [0x0629, '\u0647'],
]);

function normaliseArabic(text: string): string {
  let out = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!ARABIC_IGNORED.some(([first, last]) => codePoint >= first && codePoint <= last)) {
      out += ARABIC_VARIANTS.get(codePoint) ?? character;
    }
  }
  return out;
}
const MARKS = /\p{M}+/gu;

/**
 * The form two tokens of one non-Latin script are compared in (ours): NFKC, lower case, and per
 * script the differences that spelling does not carry (Arabic vowel marks, tatweel and letter
 * variants; Hebrew points; Greek accents and final sigma; Cyrillic ё as е).
 */
export function normaliseOriginal(token: string): string {
  const text = token.normalize('NFKC').toLowerCase();
  switch (tokenScript(text)) {
    case 'arabic':
      return normaliseArabic(text);
    case 'hebrew':
      return text.normalize('NFD').replace(MARKS, '').normalize('NFC');
    case 'greek':
      return text.normalize('NFD').replace(MARKS, '').replace(/ς/gu, 'σ').normalize('NFC');
    case 'cyrillic':
      return text.replace(/ё/gu, 'е');
    default:
      return text;
  }
}
