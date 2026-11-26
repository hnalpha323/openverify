/**
 * C77.2: the EU Financial Sanctions Files parser (XML 1.1 of the FSF, `xmlFullSanctionsList_1_1`).
 * The XSD sits behind EU Login, so the shape follows the public file's own structure (read in
 * `docs/research/phase6-data-sources.md` §3.2): an `export` root in the FSF namespace whose
 * `generationDate` is the publication time and `globalFileId` the file id, and one
 * `sanctionEntity` per entry, keyed by its `logicalId`, almost everything in attributes.
 *
 * - `subjectType@code` gives the kind (`person`, `enterprise`, `vessel`).
 * - Each `nameAlias` is a name (`wholeName`, else its parts), weak when `strong="false"`; the
 *   first is the primary name, and the first stated `gender` the gender.
 * - `citizenship`, `birthdate` (day, month and year parts, `circa`, year ranges), `identification`
 *   and `address` give countries, dates, places, identifiers and addresses; `00` is no country.
 * - Each `regulation@programme` is a programme; the earliest publication date is the listing date.
 */
import {
  WATCHLIST_RECORD_LIMITS,
  type IDENTIFIER_KINDS,
  type WatchlistEntryKind,
  type WatchlistRecord,
} from '../record/index.js';
import type { ByteSource, XmlElement } from '../xml/index.js';
import { attribute, booleanOf, childrenNamed, elementAt, textsAt } from './elements.js';
import { WatchlistParseError } from './errors.js';
import {
  parseXmlList,
  type ListParseOptions,
  type WatchlistParse,
  type XmlListFormat,
} from './list.js';
import {
  birthDate,
  calendarDate,
  cleanText,
  countryCode,
  identifierKindOf,
  partialDate,
  publicationTime,
  recordName,
  truncateText,
  type RecordDraft,
} from './normalise.js';

/** The FSF export's namespace. */
export const EU_FSF_NAMESPACE = 'http://eu.europa.ec/fpi/fsd/export';

/** Parses an EU Financial Sanctions Files XML document. */
export function parseEuFsf(source: ByteSource, options: ListParseOptions): WatchlistParse {
  return parseXmlList(source, EU_FSF_FORMAT, options);
}

type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

interface EuState {
  readonly publishedAt: string | null;
  readonly fileId: string | null;
}

const EU_FSF_FORMAT: XmlListFormat<EuState> = {
  label: 'EU FSF XML',
  root: 'export',
  namespace: EU_FSF_NAMESPACE,
  entries: ['export/sanctionEntity'],
  headers: [],
  start: (root) => ({
    publishedAt: publicationTime(attribute(root, 'generationDate')),
    fileId: attribute(root, 'globalFileId'),
  }),
  header: () => undefined,
  entry: (_state, element, ordinal) => euEntry(element, ordinal),
  publication: (state) =>
    state.fileId === null
      ? { publishedAt: state.publishedAt }
      : { publishedAt: state.publishedAt, fileId: state.fileId },
};

const KINDS: Readonly<Record<string, WatchlistEntryKind>> = Object.freeze({
  person: 'individual',
  enterprise: 'entity',
  vessel: 'vessel',
  aircraft: 'aircraft',
});

const CLASSIFICATIONS: Readonly<Record<string, WatchlistEntryKind>> = Object.freeze({
  p: 'individual',
  e: 'entity',
});

/** The FSF's identification type codes; any other code is read from its description. */
const IDENTIFIER_CODES: Readonly<Record<string, IdentifierKind>> = Object.freeze({
  passport: 'passport',
  id: 'national_id',
  ssn: 'national_id',
  fiscalcode: 'tax_id',
  regnumber: 'registration_number',
  swiftbic: 'swift_bic',
  imo: 'imo',
  lei: 'lei',
});

const GENDERS: Readonly<Record<string, NonNullable<WatchlistRecord['gender']>>> = Object.freeze({
  M: 'male',
  F: 'female',
});

const PART_ATTRIBUTES = [
  ['given', 'firstName'],
  ['middle', 'middleName'],
  ['family', 'lastName'],
] as const;

const YEAR = /^\d{1,4}$/u;

function number(text: string | null): number | null {
  return text !== null && YEAR.test(text) ? Number(text) : null;
}

function euBirthDate(element: XmlElement): WatchlistRecord['birth_dates'][number] | null {
  const from = partialDate(number(attribute(element, 'yearRangeFrom')));
  const to = partialDate(number(attribute(element, 'yearRangeTo')));
  if (from !== null && to !== null) {
    return birthDate(from, { range: { from, to } });
  }
  const value =
    calendarDate(attribute(element, 'birthdate')) ??
    partialDate(
      number(attribute(element, 'year')),
      number(attribute(element, 'monthOfYear')),
      number(attribute(element, 'dayOfMonth')),
    );
  return birthDate(value, { circa: booleanOf(attribute(element, 'circa')) === true });
}

function euEntry(element: XmlElement, ordinal: number): RecordDraft {
  const subject = elementAt(element, 'subjectType');
  const kind =
    KINDS[(attribute(subject, 'code') ?? '').toLowerCase()] ??
    CLASSIFICATIONS[(attribute(subject, 'classificationCode') ?? '').toLowerCase()];
  if (kind === undefined) {
    throw new WatchlistParseError(
      'schema',
      `entry ${String(ordinal)}: the subject type is not a person, an enterprise or a vessel`,
    );
  }
  let gender: WatchlistRecord['gender'];
  const names = childrenNamed(element, 'nameAlias').flatMap((alias, index) => {
    const parts = PART_ATTRIBUTES.flatMap(([role, name]) => {
      const value = attribute(alias, name);
      return value === null ? [] : [{ role, value }];
    });
    gender ??= GENDERS[(attribute(alias, 'gender') ?? '').toUpperCase()];
    const built = recordName(
      attribute(alias, 'wholeName') ?? parts.map((part) => part.value).join(' '),
      {
        parts,
        quality: booleanOf(attribute(alias, 'strong')) === false ? 'weak' : 'strong',
        primary: index === 0,
      },
    );
    return built === null ? [] : [built];
  });
  const countries: WatchlistRecord['countries'][number][] = [];
  const addCountry = (from: XmlElement, role: WatchlistRecord['countries'][number]['role']) => {
    const code = countryCode(attribute(from, 'countryIso2Code'));
    if (code !== null) {
      countries.push({ code, role });
    }
  };
  for (const citizenship of childrenNamed(element, 'citizenship')) {
    addCountry(citizenship, 'citizenship');
  }
  const births = childrenNamed(element, 'birthdate');
  for (const birth of births) {
    addCountry(birth, 'birth');
  }
  const identifiers = childrenNamed(element, 'identification').flatMap((document) => {
    const value =
      attribute(document, 'number') ??
      attribute(document, 'latinNumber') ??
      attribute(document, 'documentNumber');
    if (value === null) {
      return [];
    }
    const code = (attribute(document, 'identificationTypeCode') ?? '').toLowerCase();
    const kind =
      IDENTIFIER_CODES[code] ??
      identifierKindOf(attribute(document, 'identificationTypeDescription') ?? code);
    const country = countryCode(attribute(document, 'countryIso2Code'));
    return [country === null ? { kind, value } : { kind, value, country }];
  });
  const addresses = childrenNamed(element, 'address').flatMap((address) => {
    addCountry(address, 'address');
    const country = countryCode(attribute(address, 'countryIso2Code'));
    const city = attribute(address, 'city');
    const postcode = attribute(address, 'zipCode');
    const lines = ['street', 'poBox', 'place', 'region'].flatMap(
      (name) => attribute(address, name) ?? [],
    );
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
  const regulations = childrenNamed(element, 'regulation');
  const listed = [
    calendarDate(attribute(element, 'designationDate')),
    ...regulations.map((regulation) => calendarDate(attribute(regulation, 'publicationDate'))),
  ];
  const listedAt =
    listed[0] ??
    listed
      .slice(1)
      .flatMap((date) => date ?? [])
      .sort()[0];
  const remarks = cleanText(textsAt(element, 'remark').join(' '));
  return {
    entry_id: attribute(element, 'logicalId') ?? '',
    kind,
    names,
    birth_dates: births.flatMap((birth) => euBirthDate(birth) ?? []),
    birth_places: births.flatMap((birth) =>
      ['city', 'place'].flatMap((name) => attribute(birth, name) ?? []),
    ),
    countries,
    ...(gender === undefined ? {} : { gender }),
    identifiers,
    addresses,
    programs: regulations.flatMap((regulation) => attribute(regulation, 'programme') ?? []),
    ...(listedAt === undefined ? {} : { listed_at: listedAt }),
    ...(remarks === null
      ? {}
      : { remarks: truncateText(remarks, WATCHLIST_RECORD_LIMITS.remarks) }),
  };
}
