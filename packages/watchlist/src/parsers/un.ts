/**
 * C77.2: the UN Security Council Consolidated List parser (the legacy XML behind
 * `scsanctions.un.org/resources/xml/en/consolidated.xml`). Its schema URL answers no schema, so
 * the shape follows the file's own structure (read in `docs/research/phase6-data-sources.md`
 * §2.2). The source ships disabled (decision 1): its site terms are non-commercial.
 *
 * - `CONSOLIDATED_LIST@dateGenerated` is the publication time.
 * - Each `INDIVIDUAL` and `ENTITY` is one entry, keyed by its `REFERENCE_NUMBER`.
 * - `FIRST_NAME` to `FOURTH_NAME` make the primary name, without roles (the UN's order is not a
 *   given-and-family order); `NAME_ORIGINAL_SCRIPT` and each alias are names, an alias weak only
 *   when its `QUALITY` is `Low` (the data also holds `a.k.a.`, `f.k.a.` and empty values).
 * - Dates of birth read `TYPE_OF_DATE` (`EXACT`, `APPROXIMATELY` as circa, `BETWEEN` as a year
 *   range); places, nationalities, documents and addresses follow; `UN_LIST_TYPE` is the
 *   programme and `LISTED_ON` the listing date.
 */
import { WATCHLIST_RECORD_LIMITS, type WatchlistRecord } from '../record/index.js';
import type { ByteSource, XmlElement } from '../xml/index.js';
import { attribute, childrenNamed, textAt, textsAt } from './elements.js';
import {
  parseXmlList,
  type ListParseOptions,
  type WatchlistParse,
  type XmlListFormat,
} from './list.js';
import {
  birthDate,
  calendarDate,
  countryCode,
  identifierKindOf,
  partialDate,
  publicationTime,
  recordName,
  truncateText,
  type RecordDraft,
} from './normalise.js';

/** Parses a UN Security Council Consolidated List XML document. */
export function parseUnConsolidated(source: ByteSource, options: ListParseOptions): WatchlistParse {
  return parseXmlList(source, UN_CONSOLIDATED_FORMAT, options);
}

interface UnState {
  readonly publishedAt: string | null;
}

const UN_CONSOLIDATED_FORMAT: XmlListFormat<UnState> = {
  label: 'UN consolidated XML',
  root: 'CONSOLIDATED_LIST',
  namespace: null,
  entries: ['CONSOLIDATED_LIST/INDIVIDUALS/INDIVIDUAL', 'CONSOLIDATED_LIST/ENTITIES/ENTITY'],
  headers: [],
  start: (root) => ({ publishedAt: publicationTime(attribute(root, 'dateGenerated')) }),
  header: () => undefined,
  entry: (_state, element) => unEntry(element),
  publication: (state) => ({ publishedAt: state.publishedAt }),
};

type Country = WatchlistRecord['countries'][number];

const GENDERS: Readonly<Record<string, NonNullable<WatchlistRecord['gender']>>> = Object.freeze({
  male: 'male',
  female: 'female',
});

const YEAR = /^\d{4}$/u;

function year(text: string | null): string | null {
  return text !== null && YEAR.test(text) ? partialDate(Number(text)) : null;
}

/** `EXACT` (or no type): the date or year; `APPROXIMATELY`: circa; `BETWEEN`: a year range. */
function unBirthDate(element: XmlElement): WatchlistRecord['birth_dates'][number] | null {
  const type = (textAt(element, 'TYPE_OF_DATE') ?? '').toUpperCase();
  const from = year(textAt(element, 'FROM_YEAR'));
  const to = year(textAt(element, 'TO_YEAR'));
  if (type === 'BETWEEN' && from !== null && to !== null) {
    return birthDate(from, { range: { from, to } });
  }
  const value = calendarDate(textAt(element, 'DATE')) ?? year(textAt(element, 'YEAR'));
  return birthDate(value, { circa: type === 'APPROXIMATELY' });
}

function unEntry(element: XmlElement): RecordDraft {
  const individual = element.name === 'INDIVIDUAL';
  const prefix = individual ? 'INDIVIDUAL' : 'ENTITY';
  const primary = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
    .flatMap((name) => textAt(element, name) ?? [])
    .join(' ');
  const names = [
    recordName(primary, { primary: true }),
    recordName(textAt(element, 'NAME_ORIGINAL_SCRIPT')),
    ...childrenNamed(element, `${prefix}_ALIAS`).map((alias) =>
      recordName(textAt(alias, 'ALIAS_NAME'), {
        quality: (textAt(alias, 'QUALITY') ?? '').toLowerCase() === 'low' ? 'weak' : 'strong',
      }),
    ),
  ].flatMap((name) => name ?? []);
  const countries: Country[] = [];
  const addCountry = (role: Country['role'], text: string | null) => {
    const code = countryCode(text);
    if (code !== null) {
      countries.push({ code, role });
    }
  };
  for (const nationality of textsAt(element, 'NATIONALITY', 'VALUE')) {
    addCountry('nationality', nationality);
  }
  const places = childrenNamed(element, `${prefix}_PLACE_OF_BIRTH`);
  for (const place of places) {
    addCountry('birth', textAt(place, 'COUNTRY'));
  }
  const addresses = childrenNamed(element, `${prefix}_ADDRESS`).flatMap((address) => {
    const country = countryCode(textAt(address, 'COUNTRY'));
    const city = textAt(address, 'CITY');
    const postcode = textAt(address, 'ZIP_CODE');
    const lines = ['STREET', 'STATE_PROVINCE'].flatMap((name) => textAt(address, name) ?? []);
    addCountry('address', textAt(address, 'COUNTRY'));
    return country === null && city === null && postcode === null && lines.length === 0
      ? []
      : [
          {
            ...(country === null ? {} : { country }),
            ...(city === null ? {} : { city }),
            ...(postcode === null ? {} : { postcode }),
            lines,
          },
        ];
  });
  const identifiers = childrenNamed(element, `${prefix}_DOCUMENT`).flatMap((document) => {
    const value = textAt(document, 'NUMBER');
    if (value === null) {
      return [];
    }
    const kind = identifierKindOf(textAt(document, 'TYPE_OF_DOCUMENT'));
    const country = countryCode(textAt(document, 'ISSUING_COUNTRY'));
    return [country === null ? { kind, value } : { kind, value, country }];
  });
  const gender =
    GENDERS[(textAt(element, 'GENDER') ?? textAt(element, 'GENDER', 'VALUE') ?? '').toLowerCase()];
  const listedAt = calendarDate(textAt(element, 'LISTED_ON'));
  const remarks = textAt(element, 'COMMENTS1');
  return {
    entry_id: textAt(element, 'REFERENCE_NUMBER') ?? '',
    kind: individual ? 'individual' : 'entity',
    names,
    birth_dates: childrenNamed(element, `${prefix}_DATE_OF_BIRTH`).flatMap(
      (date) => unBirthDate(date) ?? [],
    ),
    birth_places: places.flatMap((place) => {
      const parts = ['CITY', 'STATE_PROVINCE'].flatMap((name) => textAt(place, name) ?? []);
      return parts.length === 0 ? [] : [parts.join(', ')];
    }),
    countries,
    ...(gender === undefined ? {} : { gender }),
    identifiers,
    addresses,
    programs: textsAt(element, 'UN_LIST_TYPE'),
    ...(listedAt === null ? {} : { listed_at: listedAt }),
    ...(remarks === null
      ? {}
      : { remarks: truncateText(remarks, WATCHLIST_RECORD_LIMITS.remarks) }),
  };
}
