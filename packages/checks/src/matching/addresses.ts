/**
 * Postal addresses (C58.4): a libpostal-style normaliser over the committed dictionaries, then a
 * component-wise comparison. Each side is read into country, postal code, house number, street
 * (name, type, directionals), unit, city and subdivision; street types, directionals and
 * place-name words compare by canonical form (St and Street, N and North, St and Saint), German
 * and Dutch street suffixes are split off (Rosenstraße is rosen + straße), and units are read from
 * their designators (Apt 4, Flat 2, #3).
 *
 * | Level | When |
 * |---|---|
 * | `full` | country, postal code, house number, street and city match exactly; the unit is equal or absent on both |
 * | `partial` | country, house number and street match, and the postal code or the city; one fuzzy component at most (a near spelling, a street type on one side); a unit on one side only |
 * | `none` | both sides carry a different house number, postal code, unit or country, or the streets differ |
 * | `missing` | no street on one side, or nothing else to decide by (a house number on one side only, two fuzzy components, different cities without a postal code) |
 *
 * A subdivision that differs caps the level at `partial` (flag `subdivision-mismatch`). Streets
 * agree at Jaro-Winkler 0.92 and cities at 0.90 (C51.3). Every line is capped at 500 code points
 * (C58.7). Only levels, component outcomes and flags leave this module, never a value.
 */
import { z } from 'zod';
import { jaroWinkler } from '../name-matching.js';
import { presentText } from '../result.js';
import { readMatchingData } from './data-files.js';
import { canonicalsOf, phraseAt, phraseEndingAt, phrasesOf } from './dictionaries.js';
import { fieldMatch, type FieldMatch, type MatchLevel, type MatchMethod } from './levels.js';
import { MATCHING_INPUT_LIMITS, capText } from './limits.js';
import {
  comparePostalCodes,
  countryAlpha2,
  findPostalCode,
  type ComponentMatch,
} from './postal-codes.js';
import { foldText } from './text.js';

/** An address as forms and records hold it: any part may be absent. */
export interface PostalAddress {
  readonly street1?: string | null | undefined;
  readonly street2?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly subdivision?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  /** ISO 3166-1 alpha-2 or alpha-3. */
  readonly countryCode?: string | null | undefined;
}

/** The components the comparison reads. */
export const ADDRESS_COMPONENTS = [
  'country',
  'postal-code',
  'house-number',
  'street',
  'unit',
  'city',
  'subdivision',
] as const;
export type AddressComponent = (typeof ADDRESS_COMPONENTS)[number];

/** An address comparison: the level, and how each component compared. */
export interface AddressMatch extends FieldMatch {
  readonly components: Readonly<Record<AddressComponent, ComponentMatch>>;
}

/** The Jaro-Winkler score at or above which two street names agree (C51.3). */
export const STREET_SIMILARITY = 0.92;
/** The Jaro-Winkler score at or above which two city names agree (C51.3). */
export const CITY_SIMILARITY = 0.9;

/**
 * Countries where the house number usually follows the street (ours, from their postal formats);
 * elsewhere it comes first.
 */
const NUMBER_LAST_COUNTRIES: ReadonlySet<string> = new Set([
  'AL',
  'AR',
  'AT',
  'BA',
  'BE',
  'BG',
  'BO',
  'BR',
  'BY',
  'CH',
  'CL',
  'CZ',
  'DE',
  'DK',
  'EC',
  'EE',
  'ES',
  'FI',
  'GR',
  'HR',
  'HU',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'ME',
  'MK',
  'MX',
  'NL',
  'NO',
  'PE',
  'PL',
  'PT',
  'PY',
  'RO',
  'RS',
  'RU',
  'SE',
  'SI',
  'SK',
  'TR',
  'UA',
  'UY',
  'VE',
]);
/** Countries whose street names join their type (Rosenstraße, Kerklaan; ours). */
const JOINED_SUFFIX_COUNTRIES: ReadonlySet<string> = new Set([
  'AT',
  'BE',
  'CH',
  'DE',
  'LI',
  'LU',
  'NL',
]);
/** Floor designators libpostal's unit list leaves out (ours). */
const LEVEL_DESIGNATORS: ReadonlySet<string> = new Set([
  'floor',
  'fl',
  'flr',
  'level',
  'lvl',
  'etage',
  'stock',
  'og',
  'piso',
  'planta',
  'andar',
  'verdieping',
]);
/** Words that only mark the house number that follows (ours). */
const NUMBER_MARKERS: ReadonlySet<string> = new Set(['no', 'nr', 'num', 'numero', 'n']);
/** Post-office-box words, each followed by the box number (ours, as `id_po_box_detection`). */
const PO_BOX_WORDS: readonly (readonly string[])[] = [
  ['po', 'box'],
  ['p', 'o', 'box'],
  ['post', 'office', 'box'],
  ['box'],
  ['postfach'],
  ['apartado'],
  ['apdo'],
  ['bp'],
  ['boite', 'postale'],
  ['casella', 'postale'],
  ['caixa', 'postal'],
  ['postbus'],
  ['postboks'],
];
/** English ordinal words as street names spell them (ours). */
const ORDINALS: Readonly<Record<string, string>> = {
  first: '1st',
  second: '2nd',
  third: '3rd',
  fourth: '4th',
  fifth: '5th',
  sixth: '6th',
  seventh: '7th',
  eighth: '8th',
  ninth: '9th',
  tenth: '10th',
  eleventh: '11th',
  twelfth: '12th',
  thirteenth: '13th',
  fourteenth: '14th',
  fifteenth: '15th',
  sixteenth: '16th',
  seventeenth: '17th',
  eighteenth: '18th',
  nineteenth: '19th',
  twentieth: '20th',
};

interface Token {
  readonly simple: string;
  readonly expanded: string;
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const NUMERIC = /^\d+(?:[-/]\d+)*[a-z]?$/;
/** A chunk: `#`, or letters and digits joined by apostrophes, hyphens or slashes. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ADDRESS_CHUNK = /#|[\p{L}\p{M}\p{N}]+(?:['/ʼ’-][\p{L}\p{M}\p{N}]+)*/gu;

/** One line's tokens: `#` and house numbers as written, words folded in both renderings. */
function tokenize(value: string): { tokens: Token[]; folded: boolean; special: boolean } {
  const text = capText(value, MATCHING_INPUT_LIMITS.address).normalize('NFKC').toLowerCase();
  const whole = foldText(text);
  const tokens: Token[] = [];
  for (const [chunk] of text.matchAll(ADDRESS_CHUNK)) {
    if (chunk === '#' || NUMERIC.test(chunk)) {
      tokens.push({ simple: chunk, expanded: chunk });
      continue;
    }
    const folded = foldText(chunk);
    const simple = folded.simplified.split(' ').filter(Boolean);
    const expanded = folded.expanded.split(' ').filter(Boolean);
    simple.forEach((token, index) => {
      tokens.push({
        simple: token,
        expanded: expanded.length === simple.length ? (expanded[index] ?? token) : token,
      });
    });
  }
  return { tokens, folded: whole.folded, special: whole.specialCharacters };
}

const simpleOf = (tokens: readonly Token[]): string[] => tokens.map((token) => token.simple);
const isUnitId = (token: string | undefined): token is string =>
  token !== undefined && token !== '#' && (/\d/.test(token) || /^[a-z]$/.test(token));

/** Takes the units out (Apt 4, Flat 2, #3, Floor 1): their ids, and the other tokens. */
function extractUnits(tokens: readonly Token[]): { rest: Token[]; ids: string[] } {
  const simple = simpleOf(tokens);
  const rest: Token[] = [];
  const ids: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const word = simple[index] ?? '';
    const designator =
      word === '#' || LEVEL_DESIGNATORS.has(word)
        ? 1
        : (phraseAt('unit-types', simple, index)?.length ?? 0);
    const id = simple[index + designator];
    if (designator > 0 && isUnitId(id)) {
      ids.push(id);
      index += designator;
    } else if (word !== '#') {
      const token = tokens[index];
      // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
      if (token !== undefined) {
        rest.push(token);
      }
    }
  }
  return { rest, ids };
}

/** A post-office box number, if the tokens are one. */
function poBoxOf(simple: readonly string[]): string | null {
  for (const words of PO_BOX_WORDS) {
    for (let start = 0; start + words.length < simple.length; start += 1) {
      const id = simple[start + words.length];
      if (
        (words[0] !== 'box' || start === 0) &&
        words.every((word, offset) => simple[start + offset] === word) &&
        id !== undefined &&
        /\d/.test(id)
      ) {
        return id;
      }
    }
  }
  return null;
}

/** The house number, read in the country's order, and the street's tokens. */
function houseNumberOf(
  tokens: readonly Token[],
  country: string | null,
): { number: string | null; rest: Token[] } {
  let kept = tokens.filter(
    (token, index) =>
      !(NUMBER_MARKERS.has(token.simple) && NUMERIC.test(tokens[index + 1]?.simple ?? '')),
  );
  // "12 a" written apart at the end, as German addresses often are.
  const [penultimate, last] = kept.slice(-2);
  if (
    penultimate !== undefined &&
    last !== undefined &&
    /^\d+$/.test(penultimate.simple) &&
    /^[a-z]$/.test(last.simple) &&
    kept.length > 2
  ) {
    const joined = `${penultimate.simple}${last.simple}`;
    kept = [...kept.slice(0, -2), { simple: joined, expanded: joined }];
  }
  const first = kept[0]?.simple ?? '';
  const final = kept.at(-1)?.simple ?? '';
  const takeFirst = () => ({ number: first, rest: kept.slice(1) });
  const takeLast = () => ({ number: final, rest: kept.slice(0, -1) });
  const numberLast = country !== null && NUMBER_LAST_COUNTRIES.has(country);
  if (numberLast ? NUMERIC.test(final) : NUMERIC.test(first)) {
    return numberLast ? takeLast() : takeFirst();
  }
  if (numberLast && NUMERIC.test(first)) {
    return takeFirst();
  }
  // Number-first countries: "Quillon Street 12" written the other way round.
  const beforeLast = kept.at(-2)?.simple ?? '';
  if (
    !numberLast &&
    kept.length >= 3 &&
    NUMERIC.test(final) &&
    canonicalsOf('street-types', beforeLast).length > 0
  ) {
    return takeLast();
  }
  return { number: null, rest: kept };
}

let joinedSuffixes: readonly string[] | undefined;

/** Splits a German or Dutch street type off its name (Rosenstraße: rosen + strasse). */
function splitJoinedSuffixes(tokens: readonly Token[]): { tokens: Token[]; split: boolean } {
  joinedSuffixes ??= phrasesOf('separable-suffixes')
    .filter((phrase) => !phrase.includes(' ') && phrase.length >= 3)
    .sort((a, b) => b.length - a.length);
  let split = false;
  const result = tokens.flatMap((token) => {
    const suffix = NUMERIC.test(token.simple)
      ? undefined
      : joinedSuffixes?.find(
          (candidate) =>
            token.simple.endsWith(candidate) && token.simple.length - candidate.length >= 3,
        );
    if (suffix === undefined) {
      return [token];
    }
    split = true;
    const stem = token.simple.slice(0, -suffix.length);
    const expandedStem = token.expanded.endsWith(suffix)
      ? token.expanded.slice(0, -suffix.length)
      : stem;
    return [
      { simple: stem, expanded: expandedStem },
      { simple: suffix, expanded: suffix },
    ];
  });
  return { tokens: result, split };
}

interface Street {
  readonly name: readonly Token[];
  readonly types: readonly string[] | null;
  readonly directionals: readonly string[] | null;
}

/** A street's name, its type (trailing, else leading) and its directionals. */
function streetOf(tokens: readonly Token[]): Street | null {
  if (tokens.length === 0) {
    return null;
  }
  let rest = [...tokens];
  const directionals: string[] = [];
  let types: readonly string[] | null = null;
  const trailingDirection =
    rest.length >= 2 ? phraseEndingAt('directionals', simpleOf(rest), rest.length) : null;
  if (trailingDirection !== null && trailingDirection.length < rest.length) {
    directionals.push(...trailingDirection.canonicals);
    rest = rest.slice(0, -trailingDirection.length);
  }
  if (rest.length >= 2) {
    const trailing = phraseEndingAt('street-types', simpleOf(rest), rest.length);
    const leading = phraseAt('street-types', simpleOf(rest), 0);
    if (trailing !== null && trailing.length < rest.length) {
      types = trailing.canonicals;
      rest = rest.slice(0, -trailing.length);
    } else if (leading !== null && leading.length < rest.length) {
      types = leading.canonicals;
      rest = rest.slice(leading.length);
    }
  }
  const leadingDirection = rest.length >= 2 ? phraseAt('directionals', simpleOf(rest), 0) : null;
  if (leadingDirection !== null && leadingDirection.length < rest.length) {
    directionals.push(...leadingDirection.canonicals);
    rest = rest.slice(leadingDirection.length);
  }
  return { name: rest, types, directionals: directionals.length > 0 ? directionals : null };
}

/** What a word of a street or city name can stand for: itself and its canonical forms. */
function expansionsOf(token: Token): ReadonlySet<string> {
  const expansions = new Set([token.simple, token.expanded]);
  for (const role of ['street-types', 'directionals', 'toponyms', 'personal-titles'] as const) {
    for (const canonical of canonicalsOf(role, token.simple)) {
      expansions.add(canonical);
    }
  }
  const ordinal = ORDINALS[token.simple];
  if (ordinal !== undefined) {
    expansions.add(ordinal);
  }
  return expansions;
}

const agree = (a: Token, b: Token): boolean => {
  const left = expansionsOf(a);
  return [...expansionsOf(b)].some((expansion) => left.has(expansion));
};

/** Two names, word by word, then glued, then by Jaro-Winkler at `threshold`. */
function compareNames(
  a: readonly Token[],
  b: readonly Token[],
  threshold: number,
  methods: Set<MatchMethod>,
): ComponentMatch {
  if (a.length === 0 || b.length === 0) {
    return a.length === 0 && b.length === 0 ? 'absent' : 'one-sided';
  }
  if (a.length === b.length && a.every((token, index) => agree(token, b[index] ?? token))) {
    return 'exact';
  }
  const glue = (tokens: readonly Token[], key: 'simple' | 'expanded') =>
    tokens.map((token) => token[key]).join('');
  if (glue(a, 'simple') === glue(b, 'simple') || glue(a, 'expanded') === glue(b, 'expanded')) {
    methods.add('tokenization');
    return 'fuzzy';
  }
  const join = (tokens: readonly Token[], key: 'simple' | 'expanded') =>
    tokens.map((token) => token[key]).join(' ');
  if (
    jaroWinkler(join(a, 'simple'), join(b, 'simple')) >= threshold ||
    jaroWinkler(join(a, 'expanded'), join(b, 'expanded')) >= threshold
  ) {
    methods.add('string_similarity');
    return 'fuzzy';
  }
  return 'mismatch';
}

/** Two sets of canonical forms (street types, directionals). */
function compareForms(a: readonly string[] | null, b: readonly string[] | null): ComponentMatch {
  if (a === null || b === null) {
    return a === null && b === null ? 'absent' : 'one-sided';
  }
  return a.some((form) => b.includes(form)) ? 'exact' : 'mismatch';
}

/** Two exact values (house numbers, units, PO boxes). */
function compareValues(a: string | null, b: string | null): ComponentMatch {
  if (a === null || b === null) {
    return a === null && b === null ? 'absent' : 'one-sided';
  }
  return a === b ? 'exact' : 'mismatch';
}

const subdivisionsSchema = z.object({
  countries: z.record(z.string(), z.array(z.array(z.string()).min(1))),
});
let subdivisions: Readonly<Record<string, readonly (readonly string[])[]>> | undefined;

/** A subdivision as its country's code when known (California is CA), else folded. */
export function canonicalSubdivision(
  value: string | null | undefined,
  country: string | null,
): string | null {
  const text = presentText(value);
  if (text === null) {
    return null;
  }
  subdivisions ??= subdivisionsSchema.parse(readMatchingData('subdivisions.json')).countries;
  const folded = foldText(capText(text, 100)).simplified;
  const entry = (country === null ? undefined : subdivisions[country])?.find(
    ([code, ...names]) => code?.toLowerCase() === folded || names.includes(folded),
  );
  return entry?.[0] ?? folded;
}

interface ReadAddress {
  readonly country: string | null;
  readonly postalCode: string | null;
  readonly houseNumber: string | null;
  readonly unit: string | null;
  readonly poBox: string | null;
  readonly street: Street | null;
  readonly city: readonly Token[];
  readonly subdivision: string | null;
  readonly methods: ReadonlySet<MatchMethod>;
}

function readAddress(address: PostalAddress, country: string | null): ReadAddress {
  const methods = new Set<MatchMethod>();
  const note = (line: { folded: boolean; special: boolean }) => {
    if (line.folded) {
      methods.add('fold_characters');
    }
    if (line.special) {
      methods.add('remove_special_characters');
    }
  };
  const units: string[] = [];
  let poBox: string | null = null;
  let streetTokens: Token[] | null = null;
  let numbered = false;
  for (const line of [address.street1, address.street2]) {
    const text = presentText(line);
    if (text === null) {
      continue;
    }
    const lineRest: Token[] = [];
    // A part after a comma holding only unit ids, once the street has its number, is the unit:
    // a floor and door as Spanish and Italian addresses write them ("Calle del Molino 27, 2B").
    for (const part of capText(text, MATCHING_INPUT_LIMITS.address).split(',')) {
      const tokenized = tokenize(part);
      note(tokenized);
      const { rest, ids } = extractUnits(tokenized.tokens);
      units.push(...ids);
      if (numbered && rest.length > 0 && rest.every((token) => isUnitId(token.simple))) {
        units.push(...simpleOf(rest));
        continue;
      }
      lineRest.push(...rest);
      numbered ||= rest.some((token) => NUMERIC.test(token.simple));
    }
    const box = poBoxOf(simpleOf(lineRest));
    if (box !== null) {
      poBox ??= box;
    } else if (lineRest.length > 0) {
      streetTokens ??= lineRest;
    }
  }
  let houseNumber: string | null = null;
  let street: Street | null = null;
  if (streetTokens !== null && poBox === null) {
    const { number, rest } = houseNumberOf(streetTokens, country);
    houseNumber = number;
    const joined =
      country !== null && JOINED_SUFFIX_COUNTRIES.has(country)
        ? splitJoinedSuffixes(rest)
        : { tokens: rest, split: false };
    if (joined.split) {
      methods.add('tokenization');
    }
    street = streetOf(joined.tokens);
  }
  const cityText = presentText(address.city);
  const city = cityText === null ? null : tokenize(cityText);
  if (city !== null) {
    note(city);
  }
  return {
    country,
    postalCode: presentText(address.postalCode),
    houseNumber,
    unit: units.length > 0 ? units.join(' ') : null,
    poBox,
    street,
    city: city?.tokens ?? [],
    subdivision: canonicalSubdivision(address.subdivision, country),
    methods,
  };
}

/** Two streets: name, type and directionals, or two PO boxes by number. */
function compareStreets(a: ReadAddress, b: ReadAddress, methods: Set<MatchMethod>): ComponentMatch {
  if (a.poBox !== null || b.poBox !== null) {
    return a.poBox !== null && b.poBox !== null ? compareValues(a.poBox, b.poBox) : 'one-sided';
  }
  if (a.street === null || b.street === null) {
    return a.street === null && b.street === null ? 'absent' : 'one-sided';
  }
  const name = compareNames(a.street.name, b.street.name, STREET_SIMILARITY, methods);
  const types = compareForms(a.street.types, b.street.types);
  const directionals = compareForms(a.street.directionals, b.street.directionals);
  if (name === 'mismatch' || types === 'mismatch' || directionals === 'mismatch') {
    return 'mismatch';
  }
  if (name === 'exact' && types !== 'one-sided' && directionals !== 'one-sided') {
    return 'exact';
  }
  if (types === 'one-sided' || directionals === 'one-sided') {
    methods.add('tokenization');
  }
  return name === 'one-sided' ? 'one-sided' : 'fuzzy';
}

const usable = (match: ComponentMatch) => match === 'exact' || match === 'fuzzy';

/** Compares two addresses. */
export function matchAddresses(a: PostalAddress, b: PostalAddress): AddressMatch {
  const leftCountry = countryAlpha2(a.countryCode);
  const rightCountry = countryAlpha2(b.countryCode);
  const country = leftCountry ?? rightCountry;
  const left = readAddress(a, leftCountry ?? country);
  const right = readAddress(b, rightCountry ?? country);
  const methods = new Set<MatchMethod>();
  const components: Record<AddressComponent, ComponentMatch> = {
    country: compareValues(leftCountry, rightCountry),
    'postal-code': comparePostalCodes(left.postalCode, right.postalCode, country),
    'house-number': compareValues(left.houseNumber, right.houseNumber),
    street: compareStreets(left, right, methods),
    unit: compareValues(left.unit, right.unit),
    city: compareNames(left.city, right.city, CITY_SIMILARITY, methods),
    subdivision: compareValues(left.subdivision, right.subdivision),
  };
  if (components['postal-code'] === 'fuzzy') {
    methods.add('string_difference');
  }
  const flags: string[] = [];
  const result = (level: MatchLevel): AddressMatch => ({
    ...fieldMatch(
      level,
      level === 'full' || level === 'partial'
        ? [...methods, ...left.methods, ...right.methods]
        : [],
      flags,
    ),
    components,
  });
  const contradicted = (['country', 'postal-code', 'house-number', 'unit', 'street'] as const).some(
    (component) => components[component] === 'mismatch',
  );
  if (contradicted) {
    return result('none');
  }
  if (!usable(components.street)) {
    flags.push(left.poBox !== null || right.poBox !== null ? 'po-box-one-sided' : 'street-missing');
    return result('missing');
  }
  const numberAgrees =
    components['house-number'] === 'exact' || components['house-number'] === 'absent';
  if (!numberAgrees) {
    flags.push('house-number-one-sided');
    return result('missing');
  }
  if (components.city === 'mismatch') {
    flags.push('city-mismatch');
  }
  if (components.subdivision === 'mismatch') {
    flags.push('subdivision-mismatch');
  }
  if (components.unit === 'one-sided') {
    flags.push('unit-one-sided');
  }
  const fuzzy = (['street', 'city', 'postal-code'] as const).filter(
    (component) => components[component] === 'fuzzy',
  ).length;
  if (
    components.street === 'exact' &&
    (components.unit === 'exact' || components.unit === 'absent') &&
    components['postal-code'] === 'exact' &&
    components.city === 'exact' &&
    components.subdivision !== 'mismatch'
  ) {
    return result('full');
  }
  if ((usable(components['postal-code']) || usable(components.city)) && fuzzy <= 1) {
    return result('partial');
  }
  if (fuzzy > 1) {
    flags.push('too-many-fuzzy-components');
  }
  return result('missing');
}

/**
 * Reads free address lines (a document's addressee block, C60.5): the line holding the
 * country's postal code gives the code and the city, the lines before it the street lines.
 * Without a postal code found, the first line is the street and the others are left out.
 */
export function addressFromLines(lines: readonly string[], countryCode: string): PostalAddress {
  const country = countryAlpha2(countryCode);
  const kept = lines
    .slice(0, MATCHING_INPUT_LIMITS.documentLinesPerPage)
    .map((line) => capText(line, MATCHING_INPUT_LIMITS.documentLineLength).trim())
    .filter(Boolean);
  let postalLine = -1;
  let postalCode: string | null = null;
  for (let index = kept.length - 1; index >= 0 && country !== null; index -= 1) {
    postalCode = findPostalCode(kept[index] ?? '', country);
    if (postalCode !== null) {
      postalLine = index;
      break;
    }
  }
  if (postalLine === -1 || postalCode === null) {
    return {
      street1: kept[0] ?? null,
      street2: null,
      city: null,
      subdivision: null,
      postalCode: null,
      countryCode: country,
    };
  }
  const line = kept[postalLine] ?? '';
  const at = line.toUpperCase().indexOf(postalCode);
  const rest = `${line.slice(0, at)} ${line.slice(at + postalCode.length)}`;
  const [city, subdivision] = rest
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let before = kept.slice(Math.max(0, postalLine - 2), postalLine);
  if (before.length === 2 && !/\d/.test(before[0] ?? '')) {
    before = before.slice(1);
  }
  return {
    street1: before[0] ?? null,
    street2: before[1] ?? null,
    city: city ?? null,
    subdivision: subdivision ?? null,
    postalCode,
    countryCode: country,
  };
}
