/**
 * C79.1, C79.2, C80.5, C84.2: the subject of a screening, built from a report's query in the
 * public request shapes: every name analysed (the name parts, a `term` and ours
 * `additional-names`, each screened), the birth date, the country (`address-country-code`, or the
 * PEP and media `country-code`, or a template's `default-country`), the gender, and the
 * identifiers normalised as the list side is (C78.3).
 */
import {
  normaliseIdentifier,
  type IdentifierKind,
  type NormalisedIdentifier,
} from '../keys/index.js';
import {
  analyseBusinessName,
  analysePersonName,
  namesExactlyEqual,
  type AnalysedName,
  type NameKind,
} from '../names/index.js';

export type SubjectGender = 'female' | 'male';

export interface ScreeningSubject {
  readonly kind: NameKind;
  readonly names: readonly AnalysedName[];
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  readonly birthdates: readonly string[];
  /** ISO 3166-1 alpha-2, upper case. */
  readonly countries: readonly string[];
  readonly gender: SubjectGender | null;
  readonly identifiers: readonly NormalisedIdentifier[];
}

/** A person's name in the public query shape: name parts or a term. */
export interface PersonQueryName {
  readonly 'name-first'?: string | null | undefined;
  readonly 'name-middle'?: string | null | undefined;
  readonly 'name-last'?: string | null | undefined;
  readonly term?: string | null | undefined;
}

/** The person query of `watchlist`, `politically-exposed-person` and `adverse-media`. */
export interface PersonQuery extends PersonQueryName {
  readonly birthdate?: string | null | undefined;
  readonly 'address-country-code'?: string | null | undefined;
  readonly 'country-code'?: string | null | undefined;
  readonly gender?: SubjectGender | null | undefined;
  readonly 'identification-number'?: string | null | undefined;
  readonly 'identification-type'?: 'passport' | 'national_id' | 'tax_id' | null | undefined;
  readonly 'identification-country-code'?: string | null | undefined;
  readonly 'additional-names'?: readonly PersonQueryName[] | null | undefined;
}

/** The business query of `business-watchlist` (C79.2). */
export interface BusinessQuery {
  readonly term: string;
  readonly 'address-country-code'?: string | null | undefined;
  readonly 'registration-number'?: string | null | undefined;
  readonly lei?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly 'swift-bic'?: string | null | undefined;
  readonly 'imo-number'?: string | null | undefined;
  readonly mmsi?: string | null | undefined;
  readonly 'aircraft-serial'?: string | null | undefined;
  readonly 'aircraft-tail'?: string | null | undefined;
}

/** A person subject; `defaultCountry` is a PEP template's `default-country` (C80.5). */
export function personSubject(
  query: PersonQuery,
  options: { readonly defaultCountry?: string | null | undefined } = {},
): ScreeningSubject {
  const names = distinct([query, ...(query['additional-names'] ?? [])].flatMap(personNamesOf));
  const country =
    countryOf(query['address-country-code']) ??
    countryOf(query['country-code']) ??
    countryOf(options.defaultCountry);
  const number = present(query['identification-number']);
  const kind = query['identification-type'] ?? null;
  const identifier =
    number === null || kind === null
      ? null
      : normaliseIdentifier(kind, number, query['identification-country-code']);
  return {
    kind: 'person',
    names,
    birthdates: present(query.birthdate) === null ? [] : [query.birthdate ?? ''],
    countries: country === null ? [] : [country],
    gender: query.gender ?? null,
    identifiers: identifier === null ? [] : [identifier],
  };
}

/** A business subject; a registration number is compared within `address-country-code`. */
export function businessSubject(query: BusinessQuery): ScreeningSubject {
  const country = countryOf(query['address-country-code']);
  const fields: readonly (readonly [IdentifierKind, string | null | undefined])[] = [
    ['registration_number', query['registration-number']],
    ['lei', query.lei],
    ['website', query.website],
    ['swift_bic', query['swift-bic']],
    ['imo', query['imo-number']],
    ['mmsi', query.mmsi],
    ['aircraft_serial', query['aircraft-serial']],
    ['aircraft_tail', query['aircraft-tail']],
  ];
  const identifiers = fields.flatMap(([kind, value]) => {
    const text = present(value);
    const normalised =
      text === null
        ? null
        : normaliseIdentifier(kind, text, kind === 'registration_number' ? country : null);
    return normalised === null ? [] : [normalised];
  });
  return {
    kind: 'business',
    names: distinct([analyseBusinessName(query.term)]),
    birthdates: [],
    countries: country === null ? [] : [country],
    gender: null,
    identifiers,
  };
}

const COUNTRY = /^[A-Z]{2}$/u;

function present(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

function countryOf(value: string | null | undefined): string | null {
  const code = (value ?? '').trim().toUpperCase();
  return COUNTRY.test(code) ? code : null;
}

/** The names of one query name: its parts, and its term when it has one. */
function personNamesOf(name: PersonQueryName): AnalysedName[] {
  const parts = [name['name-first'], name['name-middle'], name['name-last']];
  const names = parts.some((part) => present(part) !== null)
    ? [analysePersonName({ first: parts[0], middle: parts[1], last: parts[2] })]
    : [];
  const term = present(name.term);
  return term === null ? names : [...names, analysePersonName(term)];
}

/** Names with tokens, each kept once (equal after normalisation, in any order). */
function distinct(names: readonly AnalysedName[]): AnalysedName[] {
  const kept: AnalysedName[] = [];
  for (const name of names) {
    if (name.tokens.length > 0 && !kept.some((other) => namesExactlyEqual(other, name))) {
      kept.push(name);
    }
  }
  return kept;
}
