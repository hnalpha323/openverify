/**
 * Text folding and writing systems for the matchers (C58.2, C58.4, C58.6). Two renderings of a
 * text are compared: the simplified one (ä to a, as Unicode decomposition gives) and the expanded
 * one (ä to ae, ö to oe, ü to ue, å to aa, ø to oe, as ICAO 9303 and German spelling write them).
 * Both are lower case, without marks, with ß, æ, œ, þ, ð, đ, ł, ı and ħ spelled out, apostrophes
 * dropped (O'Brien is obrien) and other punctuation turned into spaces. Scripts other than Latin
 * are kept, lower-cased; two texts in different writing systems are never compared.
 */

export interface FoldedText {
  /** Folded with ä as a. */
  readonly simplified: string;
  /** Folded with ä as ae, ö as oe, ü as ue, å as aa and ø as oe. */
  readonly expanded: string;
  /** Folding changed a letter beyond its case (a mark, ß, æ ...). */
  readonly folded: boolean;
  /** Punctuation or another character that is neither letter, digit nor space was removed. */
  readonly specialCharacters: boolean;
}

/** Letters that Unicode decomposition does not reduce to a base letter. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  þ: 'th',
  ð: 'd',
  đ: 'd',
  ł: 'l',
  ı: 'i',
  ħ: 'h',
};
/** The expanded spellings of ICAO 9303 Part 3 and German practice. */
const EXPANDED_LETTERS: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  å: 'aa',
  ø: 'oe',
};
const APOSTROPHES = /['`´ʼ‘’]/g;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/** Lower case, punctuation handled, letters untouched: what folding is measured against. */
const plain = (value: string): string =>
  value.normalize('NFC').toLowerCase().replace(APOSTROPHES, '').replace(SEPARATORS, ' ').trim();

function fold(value: string, expand: boolean): string {
  const lower = value.normalize('NFC').toLowerCase();
  return (
    expand ? lower.replace(/[äåöøü]/g, (letter) => EXPANDED_LETTERS[letter] ?? letter) : lower
  )
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæðđħıłøœþ]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .trim();
}

/** Folds a text into both renderings. */
export function foldText(value: string): FoldedText {
  const simplified = fold(value, false);
  return {
    simplified,
    expanded: fold(value, true),
    folded: simplified !== plain(value),
    specialCharacters: /[^\p{L}\p{N}\p{M}\s]/u.test(value),
  };
}

/** The tokens of the simplified rendering. */
export function foldedTokens(value: string): string[] {
  const simplified = fold(value, false);
  return simplified === '' ? [] : simplified.split(' ');
}

/** The writing systems the matchers tell apart; `other` for any script not listed. */
export const WRITING_SYSTEMS = [
  'latin',
  'greek',
  'cyrillic',
  'armenian',
  'georgian',
  'hebrew',
  'arabic',
  'devanagari',
  'bengali',
  'thai',
  'han',
  'hiragana',
  'katakana',
  'hangul',
  'other',
] as const;
export type WritingSystem = (typeof WRITING_SYSTEMS)[number];

const SCRIPT_PATTERNS: readonly (readonly [WritingSystem, RegExp])[] = [
  ['latin', /\p{Script=Latin}/u],
  ['greek', /\p{Script=Greek}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['armenian', /\p{Script=Armenian}/u],
  ['georgian', /\p{Script=Georgian}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['bengali', /\p{Script=Bengali}/u],
  ['thai', /\p{Script=Thai}/u],
  ['han', /\p{Script=Han}/u],
  ['hiragana', /\p{Script=Hiragana}/u],
  ['katakana', /\p{Script=Katakana}/u],
  ['hangul', /\p{Script=Hangul}/u],
];

/** The writing systems of a text's letters; digits, spaces and punctuation have none. */
export function writingSystemsOf(value: string): ReadonlySet<WritingSystem> {
  const systems = new Set<WritingSystem>();
  for (const character of value) {
    if (!/\p{L}/u.test(character)) {
      continue;
    }
    const found = SCRIPT_PATTERNS.find(([, pattern]) => pattern.test(character));
    systems.add(found === undefined ? 'other' : found[0]);
  }
  return systems;
}

/**
 * Whether two texts are written in different writing systems (C58.2): both have letters and no
 * writing system in common, so comparing them would say nothing.
 */
export function inDifferentScripts(a: string, b: string): boolean {
  const left = writingSystemsOf(a);
  const right = writingSystemsOf(b);
  return left.size > 0 && right.size > 0 && ![...left].some((system) => right.has(system));
}
