/**
 * C78.8: how the held-out generator varies a listed name, each variant tagged with its source so
 * `evaluation-6` reports recall per source. The transliteration schemes are our own (German-style
 * and French-style romanisations of Cyrillic and a phonetic Latin-to-Cyrillic rendering), written
 * here without ICAO 9303's tables, so a cross-script case never rewards the matcher for reusing
 * the table it was built from. `watchlist-matcher` never reads this folder (H21).
 */
import type { SeededRandom } from '../random.js';

/** Where a variant comes from; recall is reported per source. */
export const VARIANT_SOURCES = [
  'exact',
  'typo',
  'order_swap',
  'dropped_middle',
  'initials',
  'joined_tokens',
  'split_tokens',
  'legal_form',
  'own_transliteration',
  'held_out_group_cross_script',
  'held_out_group_same_script',
] as const;
export type VariantSource = (typeof VARIANT_SOURCES)[number];

/** The kinds of typo: one character substituted, inserted, deleted, or two transposed. */
export const TYPO_KINDS = ['substitute', 'insert', 'delete', 'transpose'] as const;
export type TypoKind = (typeof TYPO_KINDS)[number];

/** Our own romanisation schemes of Cyrillic. */
export const CYRILLIC_SCHEMES = ['german', 'french'] as const;
export type CyrillicScheme = (typeof CYRILLIC_SCHEMES)[number];

type Rules = readonly (readonly [string, string])[];

/** Latin to Cyrillic: digraphs first, then single letters (our own phonetic choices). */
const LATIN_TO_CYRILLIC: Rules = [
  ['shch', 'щ'],
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ya', 'я'],
  ['yu', 'ю'],
  ['th', 'т'],
  ...Array.from('abcdefghijklmnopqrstuvwxyz').map(
    (letter, index) =>
      [
        letter,
        [
          'а',
          'б',
          'к',
          'д',
          'е',
          'ф',
          'г',
          'х',
          'и',
          'дж',
          'к',
          'л',
          'м',
          'н',
          'о',
          'п',
          'к',
          'р',
          'с',
          'т',
          'у',
          'в',
          'в',
          'кс',
          'й',
          'з',
        ][index] ?? letter,
      ] as const,
  ),
];

const CYRILLIC_LETTERS = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const GERMAN = [
  'a',
  'b',
  'w',
  'g',
  'd',
  'e',
  'jo',
  'sh',
  's',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'r',
  's',
  't',
  'u',
  'f',
  'ch',
  'z',
  'tsch',
  'sch',
  'schtsch',
  '',
  'y',
  '',
  'e',
  'ju',
  'ja',
];
const FRENCH = [
  'a',
  'b',
  'v',
  'g',
  'd',
  'e',
  'io',
  'j',
  'z',
  'i',
  'i',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'r',
  's',
  't',
  'ou',
  'f',
  'kh',
  'ts',
  'tch',
  'ch',
  'chtch',
  '',
  'y',
  '',
  'e',
  'iou',
  'ia',
];
const singles = (latin: readonly string[]): Rules =>
  Array.from(CYRILLIC_LETTERS, (letter, index) => [letter, latin[index] ?? ''] as const);

const CYRILLIC_TO_LATIN: Readonly<Record<CyrillicScheme, Rules>> = {
  german: singles(GERMAN),
  // French usage writes a final -ий as -i and -ый as -y.
  french: [['ий', 'i'], ['ый', 'y'], ...singles(FRENCH)],
};

function apply(rules: Rules, word: string): string {
  const lower = word.toLowerCase();
  let out = '';
  for (let index = 0; index < lower.length;) {
    const rule = rules.find(([from]) => lower.startsWith(from, index));
    out += rule === undefined ? lower.charAt(index) : rule[1];
    index += rule === undefined ? 1 : rule[0].length;
  }
  const first = word.charAt(0);
  return first !== first.toLowerCase() ? `${out.charAt(0).toUpperCase()}${out.slice(1)}` : out;
}

/** A Latin word in Cyrillic, by our own phonetic rules (capitalised as the input is). */
export function latinToCyrillic(word: string): string {
  return apply(LATIN_TO_CYRILLIC, word);
}

/** A Cyrillic word in Latin, by our own German- or French-style rules. */
export function cyrillicToLatin(word: string, scheme: CyrillicScheme): string {
  return apply(CYRILLIC_TO_LATIN[scheme], word);
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** `token` with one typo of `kind` at a random position after the first character. */
export function withTypo(random: SeededRandom, token: string, kind: TypoKind): string {
  if (token.length < 3) {
    throw new RangeError('a typo needs a token of three characters or more');
  }
  for (;;) {
    const at = random.between(1, token.length - 1);
    const letter = random.pick(Array.from(LETTERS));
    const typo =
      kind === 'substitute'
        ? `${token.slice(0, at)}${letter}${token.slice(at + 1)}`
        : kind === 'insert'
          ? `${token.slice(0, at)}${letter}${token.slice(at)}`
          : kind === 'delete'
            ? `${token.slice(0, at)}${token.slice(at + 1)}`
            : `${token.slice(0, at - 1)}${token.charAt(at)}${token.charAt(at - 1)}${token.slice(at + 1)}`;
    if (typo !== token && typo.startsWith(token.charAt(0))) {
      return typo;
    }
  }
}

/** A token's initial with a full stop (`Avery` → `A.`). */
export function initialOf(token: string): string {
  return `${token.charAt(0)}.`;
}

/** Equivalent ways to write a legal form, both directions (our own short list). */
const LEGAL_FORM_PAIRS: Rules = [
  ['Ltd', 'Limited'],
  ['LLC', 'Limited Liability Company'],
  ['GmbH', 'Gesellschaft mit beschränkter Haftung'],
  ['S.A.', 'SA'],
  ['JSC', 'Joint Stock Company'],
  ['PLC', 'Public Limited Company'],
  ['Inc.', 'Incorporated'],
  ['B.V.', 'BV'],
  ['AG', 'Aktiengesellschaft'],
  ['LLP', 'Limited Liability Partnership'],
];

/** Another way to write a legal form (`Ltd` → `Limited`), or `null` to leave it out. */
export function otherLegalForm(random: SeededRandom, form: string): string | null {
  const pair = LEGAL_FORM_PAIRS.find(([short, long]) => short === form || long === form);
  if (pair === undefined || random.chance(0.5)) {
    return null;
  }
  return pair[0] === form ? pair[1] : pair[0];
}
