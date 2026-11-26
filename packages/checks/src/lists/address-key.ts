/**
 * C101.2: the key of the graph's `address` kind, over the C58.4 dictionaries and folds, only when
 * street, city, subdivision, postal code and country are all present.
 *
 * `matchAddresses` compares two addresses, fuzzily, and its dictionaries are relations: `ave` is
 * `avenida` or `avenue`. An HMAC needs one text, so this reads each word as the canonical of its
 * class with the most spellings, which reads `St` and `Street`, `Ave` and `Avenue`, `N` and `North`
 * alike and keeps the classes apart. Two spellings it reads differently (`Ct` and `Court`, `W` and
 * `West`) give no link, never a false one: the key is exact on this form, and the matcher's
 * comparison stays the matcher's.
 */
import { canonicalSubdivision } from '../matching/addresses.js';
import {
  canonicalsOf,
  phraseAt,
  phrasesOf,
  type DictionaryRole,
} from '../matching/dictionaries.js';
import { MATCHING_INPUT_LIMITS, capText } from '../matching/limits.js';
import { canonicalPostalCode, countryAlpha2 } from '../matching/postal-codes.js';
import { foldedTokens } from '../matching/text.js';
import { ListKeyInputError, type GraphKeyInput, type ListValue } from './key-input.js';

/** Floor designators libpostal's unit list leaves out, as C58.4 reads them. */
const LEVEL_DESIGNATORS: ReadonlySet<string> = new Set(['floor', 'fl', 'flr', 'level', 'lvl']);

/** How many spellings each canonical has, per role. */
const spellings = new Map<DictionaryRole, ReadonlyMap<string, number>>();

function spellingsOf(role: DictionaryRole): ReadonlyMap<string, number> {
  const known = spellings.get(role);
  if (known !== undefined) {
    return known;
  }
  const counts = new Map<string, number>();
  for (const phrase of phrasesOf(role)) {
    for (const canonical of canonicalsOf(role, phrase)) {
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  spellings.set(role, counts);
  return counts;
}

/** The canonical of `word` with the most spellings, ties by text; `null` outside the role. */
function canonicalWord(role: DictionaryRole, word: string): string | null {
  const counts = spellingsOf(role);
  const [best] = [...canonicalsOf(role, word)].sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1),
  );
  return best ?? null;
}

/** C58.4: a unit id: it holds a digit, or is one letter. */
const isUnitId = (token: string | undefined): token is string =>
  token !== undefined && (/\d/u.test(token) || /^[a-z]$/u.test(token));

/** The words of the street lines: unit designators dropped before their ids, each word canonical. */
function streetWords(lines: readonly string[]): string[] {
  const tokens = lines.flatMap((line) =>
    foldedTokens(capText(line, MATCHING_INPUT_LIMITS.address).normalize('NFKC').toLowerCase()),
  );
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const word = tokens[index] ?? '';
    const designator = LEVEL_DESIGNATORS.has(word)
      ? 1
      : (phraseAt('unit-types', tokens, index)?.length ?? 0);
    if (designator > 0 && isUnitId(tokens[index + designator])) {
      index += designator - 1;
    } else {
      words.push(
        canonicalWord('street-types', word) ?? canonicalWord('directionals', word) ?? word,
      );
    }
  }
  return words;
}

const ZIP_PLUS_FOUR = /^\d{9}$/u;

/** A US ZIP+4 is its five-digit ZIP, as `comparePostalCodes` reads it. */
const postalOf = (code: string, country: string) =>
  country === 'US' && ZIP_PLUS_FOUR.test(code) ? code.slice(0, 5) : code;

function present(value: ListValue, member: string): string {
  const text = value[member];
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ListKeyInputError('invalid_value', member);
  }
  return text;
}

/** A part of the key, refused when nothing of it is left. */
function part(text: string, member: string): string {
  if (text === '') {
    throw new ListKeyInputError('invalid_value', member);
  }
  return text;
}

/**
 * C101.2: `<country>|<subdivision>|<postal code>|<city>|<street>`, each part folded, so a `|` in the
 * text cannot move a part. Members as the verification inputs name them.
 * @throws {ListKeyInputError} `invalid_value` naming the member that is absent or empty.
 */
export function addressKeyInput(value: ListValue): GraphKeyInput {
  const member = 'address-country-code';
  const country = part(countryAlpha2(present(value, member)) ?? '', member);
  const secondLine = value['address-street-2'];
  const firstLine = present(value, 'address-street-1');
  part(streetWords([firstLine]).join(' '), 'address-street-1');
  const street = streetWords([
    firstLine,
    ...(typeof secondLine === 'string' ? [secondLine] : []),
  ]).join(' ');
  const input = [
    country,
    part(
      canonicalSubdivision(present(value, 'address-subdivision'), country) ?? '',
      'address-subdivision',
    ),
    part(
      postalOf(canonicalPostalCode(present(value, 'address-postal-code')), country),
      'address-postal-code',
    ),
    part(foldedTokens(present(value, 'address-city')).join(' '), 'address-city'),
    street,
  ].join('|');
  return { keyKind: 'identifier-address', input };
}
