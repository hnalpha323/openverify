/**
 * Fictional names for the synthetic lists, the sandbox lists and the held-out set (C77.5, C78.8,
 * C89.1). Every name is built from authored syllables, so no fixture names a real listed person,
 * PEP or company by design. Each token carries our own Cyrillic and Arabic renderings, built
 * syllable by syllable from our own tables (not ICAO 9303's), so the lists carry original-script
 * forms the way publishers do. The Arabic rendering keeps consonants and long vowels only, as
 * Arabic writes names, so it is lossy by construction.
 */
import type { SeededRandom } from './random.js';

/** One name token in every script the generator writes. */
export interface NameToken {
  /** Capitalised Latin form, as a list prints it. */
  readonly latin: string;
  /** Our own Cyrillic rendering. */
  readonly cyrillic: string;
  /** Our own Arabic rendering (consonants and long vowels, as Arabic writes names). */
  readonly arabic: string;
  /** The lower-case Latin syllables, for split-token variants. */
  readonly syllables: readonly string[];
}

/** A fictional person's name. */
export interface FictionalPersonName {
  readonly given: NameToken;
  readonly middle: NameToken | null;
  readonly family: NameToken;
}

/** A fictional name in Han characters with its toneless pinyin (family name first). */
export interface FictionalHanName {
  readonly han: string;
  readonly familyHan: string;
  readonly givenHan: string;
  /** `Family Given` in toneless pinyin, capitalised. */
  readonly latin: string;
}

/** A fictional company name. */
export interface FictionalCompanyName {
  /** The distinctive words, capitalised. */
  readonly words: readonly string[];
  /** A generic word (`Trading`, `Shipping`), or `null`. */
  readonly generic: string | null;
  /** The legal form as written (`Ltd`, `GmbH`). */
  readonly legalForm: string;
  /** The whole name as a list prints it. */
  readonly full: string;
}

/** A piece of a syllable in Latin, Cyrillic and Arabic: `[latin, cyrillic, arabic]`. */
type Piece = readonly [string, string, string];

const ONSETS: readonly Piece[] = [
  ['b', 'б', 'ب'],
  ['d', 'д', 'د'],
  ['f', 'ф', 'ف'],
  ['g', 'г', 'غ'],
  ['h', 'х', 'ه'],
  ['k', 'к', 'ك'],
  ['l', 'л', 'ل'],
  ['m', 'м', 'م'],
  ['n', 'н', 'ن'],
  ['p', 'п', 'ب'],
  ['r', 'р', 'ر'],
  ['s', 'с', 'س'],
  ['t', 'т', 'ت'],
  ['v', 'в', 'ف'],
  ['z', 'з', 'ز'],
  ['br', 'бр', 'بر'],
  ['dr', 'др', 'در'],
  ['tr', 'тр', 'تر'],
  ['st', 'ст', 'ست'],
  ['kl', 'кл', 'كل'],
  ['gr', 'гр', 'غر'],
  ['sh', 'ш', 'ش'],
  ['th', 'т', 'ث'],
];

const VOWELS: readonly Piece[] = [
  ['a', 'а', 'ا'],
  ['e', 'е', ''],
  ['i', 'и', 'ي'],
  ['o', 'о', 'و'],
  ['u', 'у', 'و'],
  ['ai', 'ай', 'اي'],
  ['ou', 'у', 'و'],
];

const CODAS: readonly Piece[] = [
  ['', '', ''],
  ['', '', ''],
  ['n', 'н', 'ن'],
  ['r', 'р', 'ر'],
  ['l', 'л', 'ل'],
  ['s', 'с', 'س'],
  ['m', 'м', 'م'],
  ['k', 'к', 'ك'],
  ['t', 'т', 'ت'],
  ['x', 'кс', 'كس'],
];

/** Endings that make a family name read as one (our own renderings). */
const FAMILY_ENDINGS: readonly Piece[] = [
  ['ton', 'тон', 'تون'],
  ['ley', 'ли', 'لي'],
  ['wick', 'вик', 'ويك'],
  ['worth', 'уорт', 'ورث'],
  ['more', 'мор', 'مور'],
  ['dale', 'дейл', 'ديل'],
  ['field', 'филд', 'فيلد'],
  ['brook', 'брук', 'بروك'],
  ['stead', 'стед', 'ستيد'],
  ['holm', 'хольм', 'هولم'],
  ['ridge', 'ридж', 'ريدج'],
  ['ford', 'форд', 'فورد'],
  ['vale', 'вейл', 'فيل'],
  ['shaw', 'шоу', 'شو'],
  ['marsh', 'марш', 'مارش'],
  ['croft', 'крофт', 'كروفت'],
];

/** Han characters with their toneless pinyin, for family and given names. */
const HAN_FAMILY: readonly (readonly [string, string])[] = [
  ['王', 'wang'],
  ['李', 'li'],
  ['张', 'zhang'],
  ['刘', 'liu'],
  ['陈', 'chen'],
  ['杨', 'yang'],
  ['黄', 'huang'],
  ['赵', 'zhao'],
  ['吴', 'wu'],
  ['周', 'zhou'],
  ['徐', 'xu'],
  ['孙', 'sun'],
  ['马', 'ma'],
  ['朱', 'zhu'],
  ['胡', 'hu'],
  ['郭', 'guo'],
  ['高', 'gao'],
  ['林', 'lin'],
  ['罗', 'luo'],
  ['何', 'he'],
];
const HAN_GIVEN: readonly (readonly [string, string])[] = [
  ['明', 'ming'],
  ['华', 'hua'],
  ['伟', 'wei'],
  ['芳', 'fang'],
  ['静', 'jing'],
  ['丽', 'li'],
  ['强', 'qiang'],
  ['磊', 'lei'],
  ['军', 'jun'],
  ['洋', 'yang'],
  ['勇', 'yong'],
  ['艳', 'yan'],
  ['杰', 'jie'],
  ['涛', 'tao'],
  ['斌', 'bin'],
  ['超', 'chao'],
  ['秀', 'xiu'],
  ['霞', 'xia'],
  ['平', 'ping'],
  ['刚', 'gang'],
  ['晨', 'chen'],
  ['宇', 'yu'],
  ['欣', 'xin'],
  ['怡', 'yi'],
];

/** The legal forms the generator writes (as written; their canonical forms are the matcher's). */
export const SYNTHETIC_LEGAL_FORMS: readonly string[] = [
  'Ltd',
  'Limited',
  'LLC',
  'GmbH',
  'S.A.',
  'JSC',
  'OOO',
  'PLC',
  'Inc.',
  'B.V.',
  'AG',
  'LLP',
];

const GENERIC_WORDS: readonly string[] = [
  'Trading',
  'Holdings',
  'Shipping',
  'Logistics',
  'Industries',
  'Energy',
  'Capital',
  'Metals',
  'Systems',
  'Engineering',
  'Resources',
  'Ventures',
];
const VESSEL_NOUNS: readonly string[] = [
  'Star',
  'Spirit',
  'Voyager',
  'Horizon',
  'Pioneer',
  'Dawn',
  'Crest',
  'Tide',
  'Harbour',
  'Glory',
];
const PLACE_WORDS: readonly string[] = ['Harbour', 'Vale', 'Bay', 'Springs', 'Hollow', 'Crossing'];

const capitalise = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** One syllable: an onset, a vowel and, when asked, a coda. */
function syllable(random: SeededRandom, withCoda: boolean): Piece {
  const pieces = [random.pick(ONSETS), random.pick(VOWELS), withCoda ? random.pick(CODAS) : null];
  const join = (index: 0 | 1 | 2): string => pieces.map((piece) => piece?.[index] ?? '').join('');
  return [join(0), join(1), join(2)];
}

function token(pieces: readonly Piece[]): NameToken {
  return {
    latin: capitalise(pieces.map((piece) => piece[0]).join('')),
    cyrillic: capitalise(pieces.map((piece) => piece[1]).join('')),
    arabic: pieces.map((piece) => piece[2]).join(''),
    syllables: pieces.map((piece) => piece[0]),
  };
}

/** A fictional given name: two or three syllables, the last with a coda at times. */
export function fictionalGivenName(random: SeededRandom): NameToken {
  const count = random.between(2, 3);
  return token(Array.from({ length: count }, (_, index) => syllable(random, index === count - 1)));
}

/** A fictional family name: one or two syllables and a family ending. */
export function fictionalFamilyName(random: SeededRandom): NameToken {
  const count = random.between(1, 2);
  return token([
    ...Array.from({ length: count }, () => syllable(random, random.chance(0.3))),
    random.pick(FAMILY_ENDINGS),
  ]);
}

/** A fictional person's name, with a middle name when asked. */
export function fictionalPersonName(
  random: SeededRandom,
  options: { readonly middle?: boolean } = {},
): FictionalPersonName {
  return {
    given: fictionalGivenName(random),
    middle: options.middle === true ? fictionalGivenName(random) : null,
    family: fictionalFamilyName(random),
  };
}

/** A fictional name in Han characters: one family character and one or two given ones. */
export function fictionalHanName(random: SeededRandom): FictionalHanName {
  const [familyHan, familyLatin] = random.pick(HAN_FAMILY);
  const given = random.sample(HAN_GIVEN, random.between(1, 2));
  const givenHan = given.map(([han]) => han).join('');
  return {
    han: `${familyHan}${givenHan}`,
    familyHan,
    givenHan,
    latin: `${capitalise(familyLatin)} ${capitalise(given.map(([, latin]) => latin).join(''))}`,
  };
}

/** A fictional company name: one or two invented words, often a generic word, a legal form. */
export function fictionalCompanyName(random: SeededRandom): FictionalCompanyName {
  const words = Array.from(
    { length: random.between(1, 2) },
    () => fictionalGivenName(random).latin,
  );
  const generic = random.chance(0.7) ? random.pick(GENERIC_WORDS) : null;
  const legalForm = random.pick(SYNTHETIC_LEGAL_FORMS);
  const parts = [...words, ...(generic === null ? [] : [generic])];
  return { words, generic, legalForm, full: `${parts.join(' ')} ${legalForm}` };
}

/** A fictional vessel name: an invented word and a noun. */
export function fictionalVesselName(random: SeededRandom): string {
  return `${fictionalGivenName(random).latin} ${random.pick(VESSEL_NOUNS)}`;
}

/** A fictional town, for birth places and addresses. */
export function fictionalPlace(random: SeededRandom): string {
  const word = fictionalFamilyName(random).latin;
  return random.chance(0.4) ? `${word} ${random.pick(PLACE_WORDS)}` : word;
}
