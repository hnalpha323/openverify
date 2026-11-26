/**
 * C77.2: the OFAC enhanced XML parser, for the SDN list (`SDN_ENHANCED.XML`, inside the
 * single-member `SDN_ENHANCED.ZIP`) and the Consolidated list (`CONS_ENHANCED.XML`), which share
 * the schema `ENHANCED_XML.xsd` (read at SHA-256 `0c56f9f2…2b97f` on 2026-10-27). Never the CSVs:
 * their remarks column is cut at 1,000 characters, losing identifiers and addresses.
 *
 * - The publication time is `publicationInfo/dataAsOf`.
 * - Country codes come from the reference values' `isoCode` (by `refId`), else from the name.
 * - Each `entity` is one entry, keyed by its `id`; its type gives the kind.
 * - Each name translation is a name, weak when OFAC flags the name `isLowQuality`.
 * - Birth dates read `valueDate` (ranges and approximate dates included); nationality,
 *   citizenship, residency and vessel flag features give countries; website, email, SWIFT/BIC,
 *   MMSI and aircraft features, and the identity documents, give identifiers; each
 *   `Digital Currency Address - <SYMBOL>` feature gives a crypto address with its symbol as ticker.
 * - Programmes, the earliest listing date and the remarks (cut to the record's cap) follow.
 * - Each list other than the SDN List (the Consolidated, non-SDN lists) is a list membership
 *   (owner decision 9 after Workflow 6B). The file names an entry's lists and programmes side by
 *   side and ties no programme to a list, so a membership names a programme only when the entry
 *   is on that one list alone, and `null` otherwise; every programme stays in `programs`.
 */
import {
  WATCHLIST_RECORD_LIMITS,
  type IDENTIFIER_KINDS,
  type NAME_PART_ROLES,
  type WatchlistEntryKind,
  type WatchlistListMembership,
  type WatchlistRecord,
} from '../record/index.js';
import type { ByteSource, XmlElement } from '../xml/index.js';
import { openSingleMemberZip, type RandomAccessSource } from '../zip/index.js';
import { attribute, booleanOf, elementAt, elementsAt, textAt, textsAt } from './elements.js';
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

/** The enhanced XML's namespace (the XSD's target namespace). */
export const OFAC_ENHANCED_NAMESPACE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ENHANCED_XML';

/** The one member of `SDN_ENHANCED.ZIP`. */
export const OFAC_SDN_ZIP_MEMBER = 'SDN_ENHANCED.XML';

/** Parses an OFAC enhanced XML document (SDN or Consolidated). */
export function parseOfacEnhanced(source: ByteSource, options: ListParseOptions): WatchlistParse {
  return parseXmlList(source, OFAC_ENHANCED_FORMAT, options);
}

/**
 * Opens a single-member ZIP holding an OFAC enhanced XML document and parses its member.
 * `maxBytes` caps the inflated member, `maxCompressedBytes` the archive.
 */
export async function* parseOfacEnhancedZip(
  archive: RandomAccessSource,
  options: ListParseOptions & {
    readonly maxCompressedBytes: number;
    readonly memberName?: string;
  },
): WatchlistParse {
  const member = await openSingleMemberZip(archive, {
    memberName: options.memberName ?? OFAC_SDN_ZIP_MEMBER,
    maxCompressedBytes: options.maxCompressedBytes,
    maxInflatedBytes: options.maxBytes,
  });
  return yield* parseOfacEnhanced(member.inflate(), options);
}

type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];
type NamePartRole = (typeof NAME_PART_ROLES)[number];
type Country = WatchlistRecord['countries'][number];
type Identifier = WatchlistRecord['identifiers'][number];

interface OfacState {
  publishedAt: string | null;
  /** Reference value `refId` to its ISO code, `null` when the reference names no known country. */
  readonly countries: Map<string, string | null>;
}

const OFAC_ENHANCED_FORMAT: XmlListFormat<OfacState> = {
  label: 'OFAC enhanced XML',
  root: 'sanctionsData',
  namespace: OFAC_ENHANCED_NAMESPACE,
  entries: ['sanctionsData/entities/entity'],
  headers: ['sanctionsData/publicationInfo', 'sanctionsData/referenceValues/referenceValue'],
  start: () => ({ publishedAt: null, countries: new Map() }),
  header(state, path, element) {
    if (path === 'sanctionsData/publicationInfo') {
      state.publishedAt = publicationTime(textAt(element, 'dataAsOf'));
      return;
    }
    const refId = attribute(element, 'refId');
    if (refId !== null && textAt(element, 'type')?.toLowerCase() === 'country') {
      state.countries.set(
        refId,
        countryCode(textAt(element, 'isoCode')) ?? countryCode(textAt(element, 'value')),
      );
    }
  },
  entry: ofacEntry,
  publication: (state) => ({ publishedAt: state.publishedAt }),
};

const KINDS: Readonly<Record<string, WatchlistEntryKind>> = Object.freeze({
  individual: 'individual',
  entity: 'entity',
  vessel: 'vessel',
  aircraft: 'aircraft',
});

/** Name part types with a role; `Nickname` and the entity, vessel and aircraft names have none. */
const PART_ROLES: Readonly<Record<string, NamePartRole>> = Object.freeze({
  'last name': 'family',
  'first name': 'given',
  'middle name': 'middle',
  patronymic: 'patronymic',
  matronymic: 'family',
  'maiden name': 'family',
});

const COUNTRY_FEATURES: Readonly<Record<string, Country['role']>> = Object.freeze({
  'nationality country': 'nationality',
  'citizenship country': 'citizenship',
  'residency country': 'residence',
  'vessel flag': 'registration',
  'nationality of registration': 'registration',
});

const IDENTIFIER_FEATURES: Readonly<Record<string, IdentifierKind>> = Object.freeze({
  website: 'website',
  'email address': 'email',
  'swift/bic': 'swift_bic',
  mmsi: 'mmsi',
  'vessel mmsi': 'mmsi',
  'aircraft tail number': 'aircraft_tail',
  "aircraft manufacturer's serial number (msn)": 'aircraft_serial',
  'aircraft construction number (also called l/n or s/n or f/n)': 'aircraft_serial',
});

const GENDERS: Readonly<Record<string, NonNullable<WatchlistRecord['gender']>>> = Object.freeze({
  male: 'male',
  female: 'female',
});

const CRYPTO_FEATURE = /^digital currency address\s*-\s*(\S.*)$/iu;
const IMO_NUMBER = /^imo\b/iu;
const IMO_PREFIX = /^imo\s*/iu;

/** The SDN List's name as a lookup key; every other list an entry is on is a membership. */
const SDN_LIST = 'sdn list';

/** A feature or document type as a lookup key: cleaned, lower case, straight apostrophes. */
function typeKey(text: string | null): string {
  return (cleanText(text) ?? '').toLowerCase().replaceAll('’', "'");
}

function referencedCountry(state: OfacState, refId: string | null): string | null {
  return refId === null ? null : (state.countries.get(refId) ?? null);
}

/** An identity document's kind: a vessel registration is an IMO number only when it says so. */
function documentKind(type: string, value: string): IdentifierKind {
  if (typeKey(type) === 'vessel registration identification') {
    return IMO_NUMBER.test(value) ? 'imo' : 'other';
  }
  return identifierKindOf(type);
}

/** The last day of a `YYYY-MM` month as a date. */
function lastDayOf(month: string): string | null {
  for (let day = 31; day >= 28; day -= 1) {
    const date = partialDate(Number(month.slice(0, 4)), Number(month.slice(5, 7)), day);
    if (date !== null) {
      return date;
    }
  }
  return null;
}

/** The partial date a begin-to-end span covers: a day, a whole month or a whole year; else null. */
function span(beginText: string | null, endText: string | null): string | null {
  const begin = calendarDate(beginText);
  const end = calendarDate(endText) ?? begin;
  if (begin === null || end === null) {
    return null;
  }
  if (begin === end) {
    return begin;
  }
  const month = begin.slice(0, 7);
  if (begin === `${month}-01` && end === lastDayOf(month)) {
    return month;
  }
  const year = begin.slice(0, 4);
  return begin === `${year}-01-01` && end === `${year}-12-31` ? year : null;
}

/**
 * A Birthdate feature's `valueDate`: a start bound (`fromDateBegin`..`fromDateEnd`) and an end
 * bound (`toDateBegin`..`toDateEnd`), as OFAC's date periods are written. The date lies between
 * the earliest start and the latest end: one day, a whole month or a whole year keeps that
 * precision (a circa one widened by C78.4's year either side), anything else is a range.
 */
function ofacBirthDate(
  valueDate: XmlElement | undefined,
): WatchlistRecord['birth_dates'][number] | null {
  if (valueDate === undefined) {
    return null;
  }
  const bound = (...names: string[]) =>
    names.map((name) => calendarDate(textAt(valueDate, name))).find((date) => date !== null) ??
    null;
  const begin = bound('fromDateBegin', 'fromDateEnd', 'toDateBegin');
  const end = bound('toDateEnd', 'toDateBegin', 'fromDateEnd');
  if (begin === null || end === null || end < begin) {
    return null;
  }
  const whole = span(begin, end);
  if (whole !== null) {
    return birthDate(whole, { circa: booleanOf(textAt(valueDate, 'isApproximate')) === true });
  }
  const from = begin.endsWith('-01-01') ? begin.slice(0, 4) : begin;
  const to = end.endsWith('-12-31') ? end.slice(0, 4) : end;
  return birthDate(begin.slice(0, 4), { range: { from, to } });
}

function ofacNames(element: XmlElement): RecordDraft['names'] {
  return elementsAt(element, 'names', 'name').flatMap((name) => {
    const primary = booleanOf(textAt(name, 'isPrimary')) === true;
    const quality = booleanOf(textAt(name, 'isLowQuality')) === true ? 'weak' : 'strong';
    return elementsAt(name, 'translations', 'translation').flatMap((translation) => {
      const parts = elementsAt(translation, 'nameParts', 'namePart');
      const roled = parts.flatMap((part) => {
        const role = PART_ROLES[typeKey(textAt(part, 'type'))];
        const value = textAt(part, 'value');
        return role === undefined || value === null ? [] : [{ role, value }];
      });
      const full =
        textAt(translation, 'formattedFullName') ??
        parts.flatMap((part) => textAt(part, 'value') ?? []).join(' ');
      const built = recordName(full, {
        parts: roled,
        quality,
        primary: primary && booleanOf(textAt(translation, 'isPrimary')) === true,
      });
      return built === null ? [] : [built];
    });
  });
}

/**
 * Owner decision 9 after 6B: the entry's lists other than the SDN List, each once. A programme is
 * tied to a list only when the entry names that one list, since the file ties none to a list.
 */
function listMemberships(
  element: XmlElement,
  programs: readonly string[],
): WatchlistListMembership[] {
  // Each list once, by its lookup key, in the file's order and first spelling.
  const lists = new Map<string, string>();
  for (const list of textsAt(element, 'sanctionsLists', 'sanctionsList')) {
    const key = typeKey(list);
    if (!lists.has(key)) {
      lists.set(key, truncateText(list, WATCHLIST_RECORD_LIMITS.label));
    }
  }
  const others = [...lists].filter(([key]) => key !== SDN_LIST).map(([, list]) => list);
  const [only] = others;
  if (only !== undefined && lists.size === 1 && programs.length > 0) {
    return programs.map((program) => ({ list: only, program }));
  }
  return others.map((list) => ({ list, program: null }));
}

function ofacEntry(state: OfacState, element: XmlElement, ordinal: number): RecordDraft {
  const kind = KINDS[typeKey(textAt(element, 'generalInfo', 'entityType'))];
  if (kind === undefined) {
    throw new WatchlistParseError(
      'schema',
      `entry ${String(ordinal)}: the entity type is not individual, entity, vessel or aircraft`,
    );
  }
  const birthDates: WatchlistRecord['birth_dates'][number][] = [];
  const birthPlaces: string[] = [];
  const countries: Country[] = [];
  const identifiers: Identifier[] = [];
  const crypto: WatchlistRecord['crypto_addresses'][number][] = [];
  let gender: WatchlistRecord['gender'];
  for (const feature of elementsAt(element, 'features', 'feature')) {
    const typeText = textAt(feature, 'type');
    const key = typeKey(typeText);
    const value = textAt(feature, 'value');
    const role = COUNTRY_FEATURES[key];
    const identifier = IDENTIFIER_FEATURES[key];
    const ticker = typeText === null ? null : CRYPTO_FEATURE.exec(typeText)?.[1];
    if (key === 'birthdate') {
      const date = ofacBirthDate(elementAt(feature, 'valueDate'));
      if (date !== null) {
        birthDates.push(date);
      }
    } else if (key === 'place of birth' && value !== null) {
      birthPlaces.push(value);
    } else if (key === 'gender') {
      gender = GENDERS[value?.toLowerCase() ?? ''] ?? gender;
    } else if (role !== undefined) {
      const code = referencedCountry(state, textAt(feature, 'valueRefId')) ?? countryCode(value);
      if (code !== null) {
        countries.push({ code, role });
      }
    } else if (identifier !== undefined && value !== null) {
      identifiers.push({ kind: identifier, value });
    } else if (ticker !== undefined && ticker !== null && value !== null) {
      crypto.push({ raw: value, ticker: cleanText(ticker) ?? ticker });
    }
  }
  for (const document of elementsAt(element, 'identityDocuments', 'identityDocument')) {
    const value = textAt(document, 'documentNumber');
    if (value === null) {
      continue;
    }
    const kind = documentKind(textAt(document, 'type') ?? '', value);
    const number = kind === 'imo' ? value.replace(IMO_PREFIX, '') : value;
    const country = referencedCountry(
      state,
      attribute(elementAt(document, 'issuingCountry'), 'refId'),
    );
    identifiers.push(country === null ? { kind, value: number } : { kind, value: number, country });
  }
  const addresses = elementsAt(element, 'addresses', 'address').flatMap((address) => {
    const code = referencedCountry(state, attribute(elementAt(address, 'country'), 'refId'));
    const translations = elementsAt(address, 'translations', 'translation');
    const translation =
      translations.find((found) => booleanOf(textAt(found, 'isPrimary')) === true) ??
      translations[0];
    let city: string | undefined;
    let postcode: string | undefined;
    const lines: string[] = [];
    for (const part of elementsAt(translation, 'addressParts', 'addressPart')) {
      const type = typeKey(textAt(part, 'type'));
      const value = textAt(part, 'value');
      if (value === null) {
        continue;
      }
      if (type === 'city') {
        city = value;
      } else if (type === 'postal code') {
        postcode = value;
      } else {
        lines.push(value);
      }
    }
    if (code !== null) {
      countries.push({ code, role: 'address' });
    }
    return code === null && city === undefined && postcode === undefined && lines.length === 0
      ? []
      : [
          {
            ...(code === null ? {} : { country: code }),
            ...(city === undefined ? {} : { city }),
            ...(postcode === undefined ? {} : { postcode }),
            lines,
          },
        ];
  });
  const listed = elementsAt(element, 'sanctionsLists', 'sanctionsList')
    .flatMap((list) => calendarDate(attribute(list, 'datePublished')) ?? [])
    .sort();
  const remarks = textAt(element, 'generalInfo', 'remarks');
  const programs = textsAt(element, 'sanctionsPrograms', 'sanctionsProgram');
  return {
    entry_id: attribute(element, 'id') ?? '',
    kind,
    names: ofacNames(element),
    birth_dates: birthDates,
    birth_places: birthPlaces,
    countries,
    ...(gender === undefined ? {} : { gender }),
    identifiers,
    addresses,
    crypto_addresses: crypto,
    programs,
    ...(listed[0] === undefined ? {} : { listed_at: listed[0] }),
    ...(remarks === null
      ? {}
      : { remarks: truncateText(remarks, WATCHLIST_RECORD_LIMITS.remarks) }),
    list_memberships: listMemberships(element, programs),
  };
}
